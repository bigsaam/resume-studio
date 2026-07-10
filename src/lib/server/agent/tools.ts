import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { resumes } from '../db/schema';
import { validateResumeData, writeResumeData, revertToLastGood } from '../resumes';
import { compileResume } from '../compile';
import type { AgentEvent, EventQueue } from './events';

/**
 * The agent's entire capability surface: three JSON-in/JSON-out tools, each
 * closed over a single `(userId, resumeId)` pair.
 *
 * There is no `Read`, `Write`, `Bash` or `Grep` here, and none are enabled on
 * the session. That is deliberate rather than incidental: Claude Code's `Read`
 * takes an absolute path, so no choice of `cwd` would confine an untrusted
 * user. Removing the tools is the containment.
 *
 * Every handler re-resolves the resume scoped by `userId`. The route already
 * checked ownership; this makes a bug there non-exploitable rather than merely
 * unlikely.
 */

export const MCP_SERVER_NAME = 'resume';

export const ALLOWED_TOOLS = [
	'mcp__resume__get_resume',
	'mcp__resume__edit_resume',
	'mcp__resume__render_resume'
] as const;

/** One failing render, then two chances to repair it. Then we roll back. */
const MAX_REPAIRS = 2;

export interface TurnState {
	/** Data was persisted but has not since compiled. */
	dirty: boolean;
	failedRenders: number;
	/** The turn ended up rolling back to `last_good_json`. */
	reverted: boolean;
	/** Latest successful render version, for the PDF cache-buster. */
	version: number;
	/** The agent called `edit_resume` at least once and it stuck. */
	edited: boolean;
}

export function newTurnState(version: number): TurnState {
	return { dirty: false, failedRenders: 0, reverted: false, version, edited: false };
}

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });
const failure = (s: string) => ({ content: [{ type: 'text' as const, text: s }], isError: true });

export interface ToolContext {
	userId: number;
	resumeId: number;
	state: TurnState;
	events: EventQueue<AgentEvent>;
}

/** Scoped read. Returns undefined for someone else's id, never throws. */
function ownedResume(ctx: ToolContext) {
	return db
		.select()
		.from(resumes)
		.where(and(eq(resumes.id, ctx.resumeId), eq(resumes.userId, ctx.userId)))
		.get();
}

/** Built separately from the server so tests can drive the handlers directly. */
export function buildResumeTools(ctx: ToolContext) {
	const getResume = tool(
		'get_resume',
		'Return the résumé as JSON, exactly as stored. Call this before editing.',
		{},
		async () => {
			const row = ownedResume(ctx);
			if (!row) return failure('Resume not found.');
			ctx.events.push({ type: 'tool', name: 'get_resume', ok: true });
			return text(JSON.stringify({ templateId: row.templateId, title: row.title, data: row.data }, null, 1));
		}
	);

	const editResume = tool(
		'edit_resume',
		'Replace the résumé with a complete document. Validated against the schema before anything is saved; on rejection nothing changes and the failing paths are returned.',
		{
			data: z
				.record(z.unknown())
				.describe('The complete résumé document — every field, not just the ones you changed.')
		},
		async (args) => {
			if (!ownedResume(ctx)) return failure('Resume not found.');

			const result = validateResumeData(args.data);
			if (!result.ok) {
				ctx.events.push({ type: 'tool', name: 'edit_resume', ok: false });
				return failure(`Rejected — nothing was saved. The document does not match the schema:\n${result.error}`);
			}

			writeResumeData(ctx.resumeId, result.data);
			ctx.state.dirty = true;
			ctx.state.edited = true;
			ctx.events.push({ type: 'tool', name: 'edit_resume', ok: true });
			return text('Saved. Call render_resume to check that it still typesets.');
		}
	);

	const renderResume = tool(
		'render_resume',
		'Typeset the résumé to PDF. Returns the compiler error when it fails.',
		{},
		async () => {
			if (!ownedResume(ctx)) return failure('Resume not found.');

			ctx.events.push({ type: 'status', text: 'Rendering…' });
			const build = await compileResume(ctx.resumeId);

			if (build.ok) {
				ctx.state.dirty = false;
				ctx.state.version = build.version;
				ctx.events.push({ type: 'render', ok: true, version: build.version, reverted: false });
				return text('Compiled cleanly.');
			}

			ctx.state.failedRenders++;

			if (ctx.state.failedRenders > MAX_REPAIRS) {
				const rolledBack = await revertAndRebuild(ctx);
				return failure(
					rolledBack
						? 'Failed to compile three times. The résumé has been rolled back to its last working version and your edits this turn are gone. Stop editing and tell the user what broke.'
						: `Failed to compile three times and there is no working version to roll back to. Stop editing and tell the user.\n\n${build.log}`
				);
			}

			const left = MAX_REPAIRS - ctx.state.failedRenders + 1;
			ctx.events.push({ type: 'render', ok: false, version: build.version, reverted: false, log: build.log });
			return failure(
				`The résumé did not typeset. ${left} attempt${left === 1 ? '' : 's'} left before it is rolled back.\n\n${build.log}`
			);
		}
	);

	return { getResume, editResume, renderResume };
}

export function createResumeMcpServer(ctx: ToolContext) {
	const { getResume, editResume, renderResume } = buildResumeTools(ctx);
	return createSdkMcpServer({
		name: MCP_SERVER_NAME,
		version: '1.0.0',
		tools: [getResume, editResume, renderResume]
	});
}

/**
 * Roll the row back to the last blob that compiled and rebuild the PDF, so the
 * preview never shows a stale render of source that no longer exists.
 *
 * Returns false when the resume has never compiled — there is nothing to
 * roll back to, and the broken data stays put for the owner to fix by hand.
 */
export async function revertAndRebuild(ctx: ToolContext): Promise<boolean> {
	if (!revertToLastGood(ctx.resumeId)) {
		ctx.state.dirty = false;
		return false;
	}
	const rebuilt = await compileResume(ctx.resumeId);
	ctx.state.dirty = false;
	ctx.state.reverted = true;
	ctx.state.version = rebuilt.version;
	ctx.events.push({ type: 'render', ok: rebuilt.ok, version: rebuilt.version, reverted: true });
	return true;
}

/**
 * The invariant the model cannot be trusted to maintain: when a turn ends with
 * data that was persisted but never proven to compile, prove it here — and roll
 * back if it doesn't.
 */
export async function finalizeTurn(ctx: ToolContext): Promise<void> {
	if (!ctx.state.dirty) return;

	const build = await compileResume(ctx.resumeId);
	if (build.ok) {
		ctx.state.dirty = false;
		ctx.state.version = build.version;
		ctx.events.push({ type: 'render', ok: true, version: build.version, reverted: false });
		return;
	}
	await revertAndRebuild(ctx);
}
