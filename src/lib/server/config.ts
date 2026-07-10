// Runtime configuration, read once at startup. Env carries infrastructure and
// secrets; anything a user should be able to tune lives in the DB instead.
import path from 'node:path';
import { env } from '$env/dynamic/private';

function str(v: string | undefined, fallback = ''): string {
	const s = (v ?? '').trim();
	return s === '' ? fallback : s;
}

function int(v: string | undefined, fallback: number): number {
	const n = Number.parseInt((v ?? '').trim(), 10);
	return Number.isFinite(n) ? n : fallback;
}

function bool(v: string | undefined, fallback: boolean): boolean {
	const s = (v ?? '').trim();
	if (s === '') return fallback;
	return /^(1|true|yes|on)$/i.test(s);
}

function list(v: string | undefined): string[] {
	return str(v)
		.split(',')
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
}

const origin = str(env.ORIGIN, 'http://localhost:3000').replace(/\/$/, '');

// Everything writable and secret. MUST stay outside any Typst compile root —
// user resume content is `eval`'d by Typst, so anything reachable from the
// compile root is readable by that user (see lib/server/compile.ts).
const dataRoot = path.resolve(str(env.DATA_ROOT, 'data'));

export const config = {
	origin,
	port: int(env.PORT, 3000),

	dataRoot,
	databasePath: path.resolve(str(env.DATABASE_PATH, path.join(dataRoot, 'resume-studio.db'))),
	seedDir: path.resolve(str(env.SEED_DIR, 'seed')),
	/** Per-resume PDFs and per-user uploaded assets. */
	resumesDir: path.join(dataRoot, 'resumes'),
	assetsDir: path.join(dataRoot, 'assets'),
	/**
	 * `cwd` and `HOME` for the Claude Agent SDK subprocess. It writes its session
	 * store under `$HOME/.claude/`, and resuming a conversation reads it back.
	 * Pointing both here keeps that out of the image and inside the data volume.
	 *
	 * The agent has no filesystem tools, so this directory is not a sandbox
	 * boundary — it is only somewhere writable.
	 */
	agentDir: path.join(dataRoot, 'agent'),

	// --- auth ---
	googleClientId: str(env.GOOGLE_OAUTH_CLIENT_ID),
	googleClientSecret: str(env.GOOGLE_OAUTH_CLIENT_SECRET),
	allowedEmails: list(env.ALLOWED_EMAILS),
	authSecret: str(env.AUTH_SECRET) || null,
	get cookieSecure(): boolean {
		return bool(env.AUTH_COOKIE_SECURE, origin.startsWith('https://'));
	},
	get authConfigured(): boolean {
		return !!(this.googleClientId && this.googleClientSecret);
	},

	// --- rendering ---
	typstBin: str(env.TYPST_BIN, 'typst'),
	fontPath: path.resolve(str(env.FONT_PATH, 'fonts')),
	/**
	 * Vendored Typst packages. Pointing the cache here means `@preview/...`
	 * imports resolve from disk instead of being fetched at request time — no
	 * network, no third-party code pulled in mid-render.
	 */
	typstPackagePath: path.resolve(str(env.TYPST_PACKAGE_PATH, 'vendor/typst-packages')),
	typstTimeoutMs: int(env.TYPST_TIMEOUT_MS, 20_000),
	typstConcurrency: int(env.TYPST_CONCURRENCY, 2),

	// --- agent ---
	// The operator's Anthropic account pays for every user's chat.
	model: str(env.CLAUDE_MODEL, 'claude-sonnet-5'),
	maxTurns: int(env.CLAUDE_MAX_TURNS, 12),
	chatTurnsPerDay: int(env.CHAT_TURNS_PER_DAY, 100),
	/** Longest a single chat turn may run before it is aborted. */
	chatTimeoutMs: int(env.CHAT_TIMEOUT_MS, 120_000),
	/** Reject a chat message longer than this before it reaches the model. */
	maxChatMessageChars: int(env.MAX_CHAT_MESSAGE_CHARS, 4_000),
	anthropicApiKey: str(env.ANTHROPIC_API_KEY) || null,
	claudeCodeOauthToken: str(env.CLAUDE_CODE_OAUTH_TOKEN) || null,
	/** Chat is hidden and the route 503s unless the operator supplied credentials. */
	get agentConfigured(): boolean {
		return !!(this.anthropicApiKey || this.claudeCodeOauthToken);
	},

	/** Reject resume blobs larger than this before they ever reach Typst. */
	maxResumeBytes: int(env.MAX_RESUME_BYTES, 256 * 1024)
} as const;

export const authSecretFile = path.join(config.dataRoot, 'auth-secret');
