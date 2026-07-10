import crypto from 'node:crypto';
import { error } from '@sveltejs/kit';
import { and, eq, sql } from 'drizzle-orm';
import { db } from './db';
import { invites, resumes, users, type Invite, type Resume, type User } from './db/schema';
import { config } from './config';
import { sha256 } from './session';

/* ------------------------------------------------------------- redirects */

/**
 * Only ever redirect to a same-origin path. Rejects absolute URLs and the
 * protocol-relative `//evil.com` / `/\evil.com` forms.
 */
export function safeRedirect(target: string | null | undefined): string {
	if (!target) return '/';
	if (!target.startsWith('/')) return '/';
	if (target.startsWith('//') || target.startsWith('/\\')) return '/';
	return target;
}

/* --------------------------------------------------------------- invites */

const CODE_BYTES = 16; // 128 bits

export function generateInviteCode(): string {
	return crypto.randomBytes(CODE_BYTES).toString('base64url');
}

export function createInvite(opts: {
	createdBy: number;
	email?: string | null;
	note?: string | null;
	maxUses?: number;
	ttlDays?: number;
}): { code: string; invite: Invite } {
	const code = generateInviteCode();
	const expiresAt = opts.ttlDays ? new Date(Date.now() + opts.ttlDays * 86_400_000) : null;
	const invite = db
		.insert(invites)
		.values({
			codeHash: sha256(code),
			codePrefix: code.slice(0, 6),
			createdBy: opts.createdBy,
			email: opts.email?.toLowerCase() ?? null,
			note: opts.note ?? null,
			maxUses: opts.maxUses ?? 1,
			expiresAt
		})
		.returning()
		.get();
	// Plaintext is returned once, here, and never stored.
	return { code, invite };
}

/**
 * Atomically consume one use of an invite. The `WHERE` clause carries every
 * condition, so two concurrent redemptions of a single-use code can't both win.
 * Returns true only if this call actually claimed a use.
 */
export function redeemInvite(code: string, email: string): boolean {
	if (!code) return false;
	const res = db
		.update(invites)
		.set({ uses: sql`${invites.uses} + 1` })
		.where(
			and(
				eq(invites.codeHash, sha256(code)),
				eq(invites.revoked, false),
				sql`${invites.uses} < ${invites.maxUses}`,
				sql`(${invites.expiresAt} IS NULL OR ${invites.expiresAt} > ${Date.now()})`,
				sql`(${invites.email} IS NULL OR ${invites.email} = ${email.toLowerCase()})`
			)
		)
		.run();
	return res.changes === 1;
}

/* ---------------------------------------------------------------- access */

export function isAllowlisted(email: string): boolean {
	return config.allowedEmails.includes(email.toLowerCase());
}

/**
 * Decide whether this Google identity may have an account, and create it if so.
 * Returns null when access is denied.
 */
export function resolveOrCreateUser(
	identity: {
		sub: string;
		email: string;
		name: string | null;
		picture: string | null;
	},
	inviteCode: string | null
): User | null {
	const email = identity.email.toLowerCase();

	// Returning user — match on the stable Google subject first, then email.
	const existing =
		db.select().from(users).where(eq(users.googleSub, identity.sub)).get() ??
		db.select().from(users).where(eq(users.email, email)).get();

	if (existing) {
		return db
			.update(users)
			.set({
				lastLoginAt: new Date(),
				name: identity.name ?? existing.name,
				picture: identity.picture ?? existing.picture,
				googleSub: identity.sub
			})
			.where(eq(users.id, existing.id))
			.returning()
			.get();
	}

	const allowed = isAllowlisted(email);
	if (!allowed && !(inviteCode && redeemInvite(inviteCode, email))) return null;

	// The very first account is the operator; only admins can mint invites.
	const isFirst =
		db
			.select({ n: sql<number>`count(*)` })
			.from(users)
			.get()?.n === 0;

	return db
		.insert(users)
		.values({
			email,
			googleSub: identity.sub,
			name: identity.name,
			picture: identity.picture,
			role: isFirst ? 'admin' : 'user',
			lastLoginAt: new Date()
		})
		.returning()
		.get();
}

/* ------------------------------------------------------------- ownership */

/**
 * Resolve a resume *scoped to the caller*. Returns 404 (not 403) for someone
 * else's id so resume ids aren't enumerable.
 */
export function requireOwnedResume(user: User | null, resumeId: number): Resume {
	if (!user) error(401, 'Not signed in');
	if (!Number.isInteger(resumeId)) error(404, 'Not found');
	const row = db
		.select()
		.from(resumes)
		.where(and(eq(resumes.id, resumeId), eq(resumes.userId, user.id)))
		.get();
	if (!row) error(404, 'Not found');
	return row;
}

export function requireAdmin(user: User | null): User {
	if (!user) error(401, 'Not signed in');
	if (user.role !== 'admin') error(404, 'Not found');
	return user;
}
