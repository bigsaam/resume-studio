import { redirect, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { config } from '$lib/server/config';
import { getAuthUrl, randomToken } from '$lib/server/google-oidc';
import { safeRedirect } from '$lib/server/access';

const SHORT = { path: '/', httpOnly: true, sameSite: 'lax' as const, maxAge: 600 };

export const GET: RequestHandler = ({ url, cookies }) => {
	if (!config.authConfigured) {
		error(500, 'Google OAuth is not configured. Set GOOGLE_OAUTH_CLIENT_ID and _SECRET.');
	}

	// `state` defeats login CSRF; `nonce` binds the id_token to this attempt.
	const state = randomToken();
	const nonce = randomToken();
	cookies.set('g_state', state, { ...SHORT, secure: config.cookieSecure });
	cookies.set('g_nonce', nonce, { ...SHORT, secure: config.cookieSecure });

	// Carry the post-login destination and any invite code across the round trip.
	cookies.set('g_redirect', safeRedirect(url.searchParams.get('redirect')), {
		...SHORT,
		secure: config.cookieSecure
	});
	const invite = url.searchParams.get('invite') ?? '';
	cookies.set('g_invite', invite, { ...SHORT, secure: config.cookieSecure });

	redirect(302, getAuthUrl(state, nonce));
};
