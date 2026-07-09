import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { exchangeCode } from '$lib/server/google-oidc';
import { resolveOrCreateUser, safeRedirect } from '$lib/server/access';
import { createSession, setSessionCookie, safeEqual } from '$lib/server/session';
import { maybeSeedForUser } from '$lib/server/seed';

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

	const user = resolveOrCreateUser(identity, invite);
	if (!user) {
		redirect(303, '/invite?denied=1');
	}

	// Fresh session on every login (defeats session fixation).
	setSessionCookie(event, createSession(user.id, request.headers.get('user-agent')));

	maybeSeedForUser(user);

	redirect(303, dest);
};
