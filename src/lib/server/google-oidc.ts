import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from './config';

/**
 * Sign-in with Google (OIDC authorization-code flow).
 *
 * We verify the returned `id_token` against Google's published JWKS and check
 * `iss` / `aud` / `exp` / `nonce` ourselves. We do NOT simply call the userinfo
 * endpoint with an access token: an access token we didn't originate would be
 * accepted, and the id_token's `nonce` is what binds the response to *this*
 * login attempt.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const JWKS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs');
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

const jwks = createRemoteJWKSet(JWKS_URL);

export interface GoogleIdentity {
	sub: string;
	email: string;
	emailVerified: boolean;
	name: string | null;
	picture: string | null;
}

export function redirectUri(): string {
	return `${config.origin}/auth/google/callback`;
}

export function randomToken(bytes = 32): string {
	return crypto.randomBytes(bytes).toString('base64url');
}

export function getAuthUrl(state: string, nonce: string): string {
	const params = new URLSearchParams({
		client_id: config.googleClientId,
		redirect_uri: redirectUri(),
		response_type: 'code',
		scope: 'openid email profile',
		state,
		nonce,
		// This is sign-in, not an API grant: no refresh token, no offline access.
		prompt: 'select_account'
	});
	return `${AUTH_ENDPOINT}?${params}`;
}

/** Exchange the authorization code and verify the resulting id_token. */
export async function exchangeCode(code: string, expectedNonce: string): Promise<GoogleIdentity> {
	const res = await fetch(TOKEN_ENDPOINT, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			code,
			client_id: config.googleClientId,
			client_secret: config.googleClientSecret,
			redirect_uri: redirectUri(),
			grant_type: 'authorization_code'
		}),
		signal: AbortSignal.timeout(20_000)
	});

	if (!res.ok) {
		throw new Error(`token exchange failed (${res.status})`);
	}
	const body = (await res.json()) as { id_token?: string };
	if (!body.id_token) throw new Error('no id_token in token response');

	const { payload } = await jwtVerify(body.id_token, jwks, {
		issuer: ISSUERS,
		audience: config.googleClientId
		// `exp`/`iat`/signature are enforced by jwtVerify.
	});

	if (payload.nonce !== expectedNonce) throw new Error('nonce mismatch');

	const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
	const sub = typeof payload.sub === 'string' ? payload.sub : '';
	if (!sub || !email) throw new Error('id_token missing sub/email');

	// Google will hand out unverified addresses on some accounts. Without this
	// check a user could assert someone else's email.
	if (payload.email_verified !== true) throw new Error('email not verified with Google');

	return {
		sub,
		email,
		emailVerified: true,
		name: typeof payload.name === 'string' ? payload.name : null,
		picture: typeof payload.picture === 'string' ? payload.picture : null
	};
}
