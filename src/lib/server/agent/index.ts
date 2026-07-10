import fs from 'node:fs';
import path from 'node:path';
import {
	query,
	type CanUseTool,
	type Options,
	type SDKMessage,
	type SDKResultMessage
} from '@anthropic-ai/claude-agent-sdk';
import { config } from '../config';
import { getTemplate } from '../templates';
import type { Resume } from '../db/schema';
import { setAgentSessionId } from '../chat';
import { recordTokens } from '../usage';
import { buildSystemPrompt } from './prompt';
import { ALLOWED_TOOLS, createResumeMcpServer, finalizeTurn, newTurnState, type ToolContext } from './tools';
import { EventQueue, type AgentEvent } from './events';

export { EventQueue };
export type { AgentEvent };

/**
 * One chat turn against one résumé.
 *
 * ## Containment
 *
 * `tools: []` removes every built-in tool — no `Read`, `Write`, `Bash`, `Grep`,
 * `WebFetch`. The only capabilities are the three MCP tools in `tools.ts`, each
 * bound to this user's résumé. Every call is then routed through `canUseTool`,
 * which allows those three by name and denies everything else — so a future SDK
 * that reintroduced a tool by default would still find it blocked.
 *
 * `settingSources: []` matters as much: the SDK otherwise loads
 * `~/.claude/settings.json` and any `CLAUDE.md` under `cwd` — operator config
 * leaking into a multi-tenant server.
 *
 * ## The compile invariant
 *
 * The model may edit and then stop, or edit and then fail to render. Neither is
 * allowed to leave a résumé whose stored JSON doesn't typeset: `finalizeTurn`
 * runs in a `finally` and rolls back to `last_good_json` if needed.
 */
export interface ChatTurnOptions {
	resume: Resume;
	userId: number;
	message: string;
	/** Aborts the model call when the client disconnects. */
	signal: AbortSignal;
}

export interface TurnSummary {
	/** The assistant's final prose, for the transcript. Empty unless it succeeded. */
	assistantText: string;
	/** The provider charged for tokens. */
	billed: boolean;
	/**
	 * The turn was cut short — the caller cancelled, or it hit `chatTimeoutMs`.
	 * Such a turn is *not* refunded: otherwise starting and immediately
	 * cancelling turns would spawn SDK subprocesses for free, for as long as the
	 * user cared to.
	 */
	aborted: boolean;
	version: number;
	reverted: boolean;
}

const DENY = (name: string) =>
	`${name} is not available. This assistant may only call get_resume, edit_resume and render_resume.`;

const TIMED_OUT = 'The assistant took too long and was stopped. Try asking for a smaller change.';

/**
 * `finished` never rejects — a failed turn pushes an `error` event and resolves
 * with `billed: false`, which is what tells the caller the turn is refundable.
 */
export function runChatTurn(opts: ChatTurnOptions): {
	events: EventQueue<AgentEvent>;
	finished: Promise<TurnSummary>;
} {
	const events = new EventQueue<AgentEvent>();
	const finished = drive(opts, events).finally(() => events.close());
	return { events, finished };
}

async function drive(opts: ChatTurnOptions, events: EventQueue<AgentEvent>): Promise<TurnSummary> {
	const { resume, userId, message, signal } = opts;

	const ctx: ToolContext = {
		userId,
		resumeId: resume.id,
		state: newTurnState(resume.renderVersion),
		events
	};

	const controller = new AbortController();
	const abort = () => controller.abort();
	signal.addEventListener('abort', abort, { once: true });

	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		abort();
	}, config.chatTimeoutMs);

	// `updatedInput` REPLACES the tool's arguments — pass them straight through.
	const canUseTool: CanUseTool = async (name, input) =>
		(ALLOWED_TOOLS as readonly string[]).includes(name)
			? { behavior: 'allow', updatedInput: input }
			: { behavior: 'deny', message: DENY(name) };

	const acc: Accumulator = { text: '', tokens: 0, stepInput: 0, stepOutput: 0, succeeded: false, errored: false };

	// Everything that can throw lives inside the `try`, so `finally` always runs
	// and `drive()` keeps its promise never to reject. `getTemplate()` throws on
	// a résumé whose template was removed in a later deploy; `mkdirSync` throws
	// on a full or read-only volume. Both used to escape before the `try`, taking
	// the timer, the abort listener and the caller's quota refund with them.
	try {
		events.push({ type: 'status', text: 'Thinking…' });

		// The SDK buckets project-scoped state — the session store, and anything
		// auto-memory writes — under `$HOME/.claude/projects/<sanitized cwd>/`. One
		// shared cwd would put every tenant in the same bucket, so give each résumé
		// its own. The résumé is the unit: `agent_session_id` is per-résumé too.
		const agentHome = path.join(config.agentDir, String(resume.id));
		fs.mkdirSync(agentHome, { recursive: true });

		const options: Options = {
			model: config.model,
			maxTurns: config.maxTurns,
			systemPrompt: buildSystemPrompt(getTemplate(resume.templateId)),
			// No built-in tools at all. See the containment note above.
			tools: [],
			mcpServers: { resume: createResumeMcpServer(ctx) },
			// Deliberately NOT `allowedTools: [...ALLOWED_TOOLS]`. A bare name there
			// auto-approves that tool *before* `canUseTool` is consulted — the SDK
			// warns about exactly this (CLAUDE_SDK_CAN_USE_TOOL_SHADOWED). Leaving
			// the list empty routes every single tool call through the callback, so
			// there is one place that decides, and it defaults to deny.
			canUseTool,
			// Load no `~/.claude/settings.json`, no `.claude/`, no `CLAUDE.md`.
			// The default is to load all three — operator config in a tenant's session.
			settingSources: [],
			// `settingSources: []` only disables *filesystem* settings. Auto-memory and
			// its background consolidation are governed by a server-side default, so
			// turn them off by name: nothing a user says should outlive their turn.
			managedSettings: { autoMemoryEnabled: false, autoDreamEnabled: false },
			permissionMode: 'default',
			cwd: agentHome,
			// `env` REPLACES the subprocess environment when set, so inherit first.
			env: { ...process.env, HOME: agentHome },
			resume: resume.agentSessionId ?? undefined,
			includePartialMessages: true,
			abortController: controller
		};

		for await (const msg of query({ prompt: message, options }) as AsyncIterable<SDKMessage>) {
			if (signal.aborted) break;
			handleMessage(msg, ctx, events, acc);
		}
	} catch (err) {
		// A caller-initiated cancel is not an error worth reporting back to them.
		if (!signal.aborted && !acc.errored) {
			acc.errored = true;
			events.push({ type: 'error', message: timedOut ? TIMED_OUT : describe(err) });
		}
	} finally {
		clearTimeout(timeout);
		signal.removeEventListener('abort', abort);

		// An aborted turn still cost whatever it had already spent.
		billUnfinished(userId, acc);

		// Runs even on abort or model error: a persisted-but-unproven edit must
		// never survive the turn.
		try {
			await finalizeTurn(ctx);
		} catch (err) {
			// The safety-net compile itself failed. `last_good_json` is untouched,
			// so the next form save or chat turn will retry.
			console.warn('[agent] finalize failed for resume', ctx.resumeId, err);
		}

		// `done` is the success terminator. A turn that errored has already sent
		// `error`, and sending both would let the client render the failure twice.
		if (acc.succeeded && !acc.errored && !signal.aborted) {
			events.push({
				type: 'done',
				text: acc.text.trim(),
				version: ctx.state.version,
				reverted: ctx.state.reverted
			});
		}
	}

	return {
		// Only a clean turn contributes to the transcript. The provider's failure
		// strings ("Invalid API key …") are not the assistant speaking.
		assistantText: acc.succeeded && !acc.errored ? acc.text.trim() : '',
		billed: acc.tokens > 0,
		aborted: signal.aborted || controller.signal.aborted,
		version: ctx.state.version,
		reverted: ctx.state.reverted
	};
}

interface Accumulator {
	text: string;
	/** Tokens recorded against the user. Zero means the turn is refundable. */
	tokens: number;
	/** Per-step usage, summed. Only used if the turn never produces a `result`. */
	stepInput: number;
	stepOutput: number;
	succeeded: boolean;
	errored: boolean;
}

function handleMessage(
	msg: SDKMessage,
	ctx: ToolContext,
	events: EventQueue<AgentEvent>,
	acc: Accumulator
): void {
	switch (msg.type) {
		case 'system':
			// `msg.tools` here is exactly ALLOWED_TOOLS — verified against a live
			// session. `tools: []` strips the built-ins without touching MCP tools.
			if (msg.subtype === 'init') persistSession(ctx.resumeId, msg.session_id);
			return;

		case 'stream_event': {
			const ev = msg.event;
			if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta' && ev.delta.text) {
				events.push({ type: 'delta', text: ev.delta.text });
				acc.text += ev.delta.text;
			}
			return;
		}

		case 'assistant':
			// Per-step usage, accumulated but NOT recorded: the final `result`
			// carries the cumulative total for the whole turn (verified: four
			// steps of 100 in / 30 out arrive as `result.usage` 400 / 120), so
			// recording both would double-count. This is only a floor to fall
			// back on when the turn is cut short before any `result` arrives.
			addStepUsage((msg.message as { usage?: TokenUsage }).usage, acc);
			return;

		case 'result': {
			persistSession(ctx.resumeId, msg.session_id);
			bill(msg.usage, ctx.userId, acc);

			// `subtype: 'success'` is NOT sufficient — the SDK reports a provider
			// failure (a rejected API key, say) as a success whose `result` string
			// is the error text, with `is_error` set. Treating that as the
			// assistant's reply would put "Invalid API key" in the user's transcript.
			if (msg.subtype === 'success' && !msg.is_error) {
				acc.succeeded = true;
				// `result` is authoritative; the deltas were interleaved with tools.
				acc.text = msg.result || acc.text;
				return;
			}

			console.warn('[agent] turn ended in failure:', msg.subtype, 'is_error=', msg.is_error);
			acc.errored = true;
			// The partial text is not trustworthy once the turn failed.
			acc.text = '';
			events.push({ type: 'error', message: explainResult(msg.subtype) });
			return;
		}

		default:
			return;
	}
}

interface TokenUsage {
	input_tokens?: number;
	output_tokens?: number;
	cache_read_input_tokens?: number;
	cache_creation_input_tokens?: number;
}

/** Cached reads and cache writes are billed too — count them all as input. */
function split(usage: TokenUsage): { input: number; output: number } {
	return {
		input:
			(usage.input_tokens ?? 0) +
			(usage.cache_read_input_tokens ?? 0) +
			(usage.cache_creation_input_tokens ?? 0),
		output: usage.output_tokens ?? 0
	};
}

/** Authoritative, cumulative usage for the whole turn. */
function bill(usage: SDKResultMessage['usage'] | undefined, userId: number, acc: Accumulator): void {
	if (!usage) return;
	const { input, output } = split(usage);
	if (input + output === 0) return;

	acc.tokens += input + output;
	recordTokens(userId, input, output);
}

function addStepUsage(usage: TokenUsage | undefined, acc: Accumulator): void {
	if (!usage) return;
	const { input, output } = split(usage);
	acc.stepInput += input;
	acc.stepOutput += output;
}

/**
 * A turn cut short — the client hung up, the timeout fired — never yields a
 * `result`, so nothing has been recorded even though the provider charged for
 * every step that completed. Record the per-step floor instead, so the spend is
 * visible and the turn is not mistaken for refundable.
 *
 * It is a floor, not the truth: an assistant message's `output_tokens` is the
 * count at `message_start`, before the model finished writing.
 */
function billUnfinished(userId: number, acc: Accumulator): void {
	if (acc.tokens > 0) return; // A `result` already recorded the real total.
	const total = acc.stepInput + acc.stepOutput;
	if (total === 0) return;

	acc.tokens += total;
	recordTokens(userId, acc.stepInput, acc.stepOutput);
	console.warn('[agent] turn ended without a result; recorded a per-step floor of', total, 'tokens');
}

function explainResult(subtype: SDKResultMessage['subtype']): string {
	switch (subtype) {
		case 'error_max_turns':
			return 'The assistant gave up after too many steps. Try asking for a smaller change.';
		case 'error_max_budget_usd':
			return 'This turn hit its spending limit.';
		default:
			return 'The assistant is unavailable right now. Please try again.';
	}
}

function persistSession(resumeId: number, sessionId: string | undefined): void {
	if (sessionId) setAgentSessionId(resumeId, sessionId);
}

/**
 * Provider errors can carry the model name, the API key source and request ids.
 * The operator gets the detail; the user gets a sentence.
 *
 * Cancellation is not routed through here — the caller's own `signal.aborted`
 * and the `timedOut` flag classify that, because the SDK's `AbortError` does not
 * override `Error.prototype.name` and so cannot be recognised by name.
 */
function describe(err: unknown): string {
	console.warn('[agent] turn failed:', err instanceof Error ? err.stack || err.message : err);
	return 'The assistant is unavailable right now. Please try again.';
}
