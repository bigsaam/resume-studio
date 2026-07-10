import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
// Relative, not `$lib` — drizzle-kit compiles this file outside Vite, so the
// SvelteKit alias isn't available here.
import type { ResumeData } from '../templates/schema';

const now = sql`(unixepoch() * 1000)`;

/* ------------------------------------------------------------------ users */

export const users = sqliteTable('users', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	email: text('email').notNull().unique(),
	/** Google's stable subject id. Survives the user changing their email. */
	googleSub: text('google_sub').notNull().unique(),
	name: text('name'),
	picture: text('picture'),
	/** Only admins may mint invite codes. The first user to sign in is admin. */
	role: text('role', { enum: ['admin', 'user'] })
		.notNull()
		.default('user'),
	// No `theme` column: the light/dark choice is a per-device preference and
	// lives in `localStorage`, where the inline script in `app.html` can read it
	// before first paint. A server round-trip could only be slower and wronger.
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
	lastLoginAt: integer('last_login_at', { mode: 'timestamp_ms' })
});

/* --------------------------------------------------------------- sessions */

/**
 * Opaque, DB-backed sessions. The cookie holds a random token; we store only
 * its SHA-256. This binds a session to a userId — unlike an HMAC-of-expiry
 * cookie, which proves only that *someone* logged in.
 */
export const sessions = sqliteTable(
	'sessions',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tokenHash: text('token_hash').notNull().unique(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		userAgent: text('user_agent'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => ({
		byUser: index('idx_sessions_user').on(t.userId),
		byExpiry: index('idx_sessions_expiry').on(t.expiresAt)
	})
);

/* ---------------------------------------------------------------- resumes */

export const resumes = sqliteTable(
	'resumes',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		templateId: text('template_id').notNull(),
		title: text('title').notNull(),
		/** Source of truth for the rendered PDF. */
		data: text('data', { mode: 'json' }).$type<ResumeData>().notNull(),
		/** Last blob that compiled cleanly. The revert target when an edit breaks. */
		lastGoodJson: text('last_good_json', { mode: 'json' }).$type<ResumeData>(),
		/** Bumped on every successful compile; used as the PDF cache-buster. */
		renderVersion: integer('render_version').notNull().default(0),
		/** Claude Agent SDK session id, so chat resumes with context. Per resume. */
		agentSessionId: text('agent_session_id'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now)
	},
	(t) => ({ byUser: index('idx_resumes_user').on(t.userId) })
);

/* ----------------------------------------------------------- chat history */

export const chatMessages = sqliteTable(
	'chat_messages',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		resumeId: integer('resume_id')
			.notNull()
			.references(() => resumes.id, { onDelete: 'cascade' }),
		role: text('role', { enum: ['user', 'assistant'] }).notNull(),
		text: text('text').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now)
	},
	(t) => ({ byResume: index('idx_chat_resume').on(t.resumeId, t.createdAt) })
);

/* ---------------------------------------------------------------- invites */

/**
 * Invite codes are stored hashed (never plaintext) and redeemed atomically.
 * Only admins may create them.
 */
export const invites = sqliteTable(
	'invites',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		codeHash: text('code_hash').notNull().unique(),
		/** Shown once at creation so the admin can copy it; not enough to redeem. */
		codePrefix: text('code_prefix').notNull(),
		createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
		/** Optionally bind a code to one address. */
		email: text('email'),
		note: text('note'),
		uses: integer('uses').notNull().default(0),
		maxUses: integer('max_uses').notNull().default(1),
		revoked: integer('revoked', { mode: 'boolean' }).notNull().default(false),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now)
	},
	(t) => ({ byHash: uniqueIndex('uq_invites_hash').on(t.codeHash) })
);

/* ----------------------------------------------------------------- assets */

/**
 * Uploaded images (profile photo, education logos). Resume JSON references the
 * opaque `id`, never a filesystem path — otherwise a crafted path could escape
 * the per-user asset directory.
 */
export const assets = sqliteTable(
	'assets',
	{
		id: text('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: ['photo', 'logo'] }).notNull(),
		/** Stored on disk as `${config.assetsDir}/${userId}/${id}${ext}`. */
		ext: text('ext').notNull(),
		bytes: integer('bytes').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now)
	},
	(t) => ({ byUser: index('idx_assets_user').on(t.userId) })
);

/* ------------------------------------------------------------------ usage */

/** Per-user, per-day agent spend. Enforces the daily cap. */
export const usage = sqliteTable(
	'usage',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		/** `YYYY-MM-DD` in UTC. */
		day: text('day').notNull(),
		turns: integer('turns').notNull().default(0),
		inputTokens: integer('input_tokens').notNull().default(0),
		outputTokens: integer('output_tokens').notNull().default(0)
	},
	(t) => ({ byUserDay: uniqueIndex('uq_usage_user_day').on(t.userId, t.day) })
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Resume = typeof resumes.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type Usage = typeof usage.$inferSelect;
