import crypto from 'node:crypto';
import fs from 'node:fs';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { db } from './db';
import { sessions, users, type User } from './db/schema';
import { config, authSecretFile } from './config';

/**
 * Opaque, DB-backed sessions.
 *
 * The cookie carries a random 32-byte token; only its SHA-256 is stored. The
 * row maps that hash to a `userId`, so a session names *who* is signed in.
 * (A signed-expiry cookie would only prove that *someone* signed in — every
 * such cookie would be interchangeable between users.)
 */

export const SESSION_COOKIE = 'rs_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/* --------------------------------------------------------------- helpers */

let cachedSecret: string | null = null;

/** Used to sign short-lived OAuth state/nonce cookies. Persisted so restarts don't log everyone out. */
export function secret(): string {
	if (cachedSecret) return cachedSecret;
	if (config.authSecret) return (cachedSecret = config.authSecret);
	try {
		const existing = fs.readFileSync(authSecretFile, 'utf-8').trim();
		if (existing) return (cachedSecret = existing);
	} catch {
		/* generate below */
	}
	cachedSecret = crypto.randomBytes(32).toString('hex');
	fs.mkdirSync(config.dataRoot, { recursive: true });
	fs.writeFileSync(authSecretFile, cachedSecret, { mode: 0o600 });
	return cachedSecret;
}

export function sha256(v: string): string {
	return crypto.createHash('sha256').update(v).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	if (ab.length !== bb.length) return false;
	return crypto.timingSafeEqual(ab, bb);
}

export function sessionCookieOptions() {
	return {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: config.cookieSecure,
		maxAge: SESSION_TTL_MS / 1000
	} as const;
}

/* -------------------------------------------------------------- lifecycle */

/** Mint a fresh session. Always called *after* a successful login (rotation). */
export function createSession(userId: number, userAgent: string | null): string {
	const token = crypto.randomBytes(32).toString('base64url');
	db.insert(sessions)
		.values({
			tokenHash: sha256(token),
			userId,
			userAgent: userAgent?.slice(0, 300) ?? null,
			expiresAt: new Date(Date.now() + SESSION_TTL_MS)
		})
		.run();
	return token;
}

/** Resolve a raw cookie token to its user, or null. */
export function resolveSession(token: string | undefined): User | null {
	if (!token) return null;
	const row = db
		.select({ user: users })
		.from(sessions)
		.innerJoin(users, eq(sessions.userId, users.id))
		.where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())))
		.get();
	return row?.user ?? null;
}

export function destroySession(token: string | undefined): void {
	if (!token) return;
	db.delete(sessions).where(eq(sessions.tokenHash, sha256(token))).run();
}

/** Housekeeping: drop expired rows. Cheap; called at boot. */
export function purgeExpiredSessions(): void {
	db.delete(sessions).where(lt(sessions.expiresAt, new Date())).run();
}

export function setSessionCookie(event: RequestEvent, token: string): void {
	event.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
}
