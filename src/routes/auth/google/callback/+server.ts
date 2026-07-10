import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { exchangeCode } from '$lib/server/google-oidc';
import { isAllowlisted, resolveOrCreateUser, safeRedirect } from '$lib/server/access';
import { createSession, setSessionCookie, safeEqual } from '$lib/server/session';
import { maybeSeedForUser } from '$lib/server/seed';
import { RateLimiter } from '$lib/server/ratelimit';
import { config } from '$lib/server/config';

/** Invite-code guesses, per client address. See `ratelimit.ts` on scope. */
const inviteAttempts = new RateLimiter(config.inviteAttemptsPerHour, 3_600_000);

function clear(cookies: Parameters<RequestHandler>[0]['cookies']) {
	for (const n of ['g_state', 'g_nonce', 'g_redirect', 'g_invite']) cookies.delete(n, { path: '/' });
}

export const GET: RequestHandler = async (event) => {
	const { url, cookies, request } = event;

	if (url.searchParams.get('error')) {
		clear(cookies);
		redirect(303, '/login?error=denied');
	}

	const code = url.searchParams.get('code') ?? '';
	const state = url.searchParams.get('state') ?? '';
	const expectedState = cookies.get('g_state') ?? '';
	const nonce = cookies.get('g_nonce') ?? '';
	const dest = safeRedirect(cookies.get('g_redirect'));
	const invite = cookies.get('g_invite') || null;

	// Single-use: burn the round-trip cookies no matter what happens next.
	clear(cookies);

	if (!code || !state || !expectedState || !safeEqual(state, expectedState) || !nonce) {
		redirect(303, '/login?error=state');
	}

	let identity;
	try {
		identity = await exchangeCode(code, nonce);
	} catch {
		// Don't echo the provider's error text back to the browser.
		redirect(303, '/login?error=oauth');
	}

	// Codes are 128-bit and stored hashed, and reaching this line already costs a
	// full Google round-trip — but nothing bounded the guessing, so bound it.
	// Only redemptions are metered; an allowlisted user signing in is not a guess.
	const guessing = invite !== null && !isAllowlisted(identity.email);
	if (guessing && !inviteAttempts.check(event.getClientAddress()).ok) {
		redirect(303, '/invite?denied=1&slow=1');
	}

	const user = resolveOrCreateUser(identity, invite);
	if (!user) {
		redirect(303, '/invite?denied=1');
	}

	// A code that worked was not a guess. Hand the attempt back, so a household
	// behind one address can onboard several people in an hour.
	if (guessing) inviteAttempts.refund(event.getClientAddress());

	// Fresh session on every login (defeats session fixation).
	setSessionCookie(event, createSession(user.id, request.headers.get('user-agent')));

	maybeSeedForUser(user);

	redirect(303, dest);
};
