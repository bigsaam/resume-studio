import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOwnedResume } from '$lib/server/access';
import { appendChatMessage, clearChat, listChatMessages } from '$lib/server/chat';
import { runChatTurn, type AgentEvent } from '$lib/server/agent';
import { reserveTurn, refundTurn } from '$lib/server/usage';
import { tryLock, unlock } from '$lib/server/locks';
import { RateLimiter } from '$lib/server/ratelimit';
import { config } from '$lib/server/config';

/**
 * Burst control, on top of the daily ceilings in `usage.ts`. A user with 100
 * turns a day could still fire them all at once and monopolise the Typst
 * semaphore. In memory, so it bounds one process — see `ratelimit.ts`.
 */
const burst = new RateLimiter(config.chatTurnsPerMinute, 60_000);

/**
 * One chat turn, streamed as NDJSON.
 *
 * The per-resume lock is taken *before* the response body starts, so a busy
 * résumé gets a clean `409` instead of a stream that dies mid-flight. It is
 * released exactly once — on normal completion, on client disconnect
 * (`cancel`), and on error.
 *
 * A turn is reserved against the user's daily quota before the model is called,
 * and refunded only when nothing was billed and the caller didn't cancel.
 */

export const GET: RequestHandler = ({ params, locals }) => {
	const resume = requireOwnedResume(locals.user, Number(params.id));
	return json({
		messages: listChatMessages(resume.id).map((m) => ({ role: m.role, text: m.text, at: m.createdAt })),
		enabled: config.agentConfigured
	});
};

export const DELETE: RequestHandler = ({ params, locals }) => {
	const resume = requireOwnedResume(locals.user, Number(params.id));
	// Don't wipe a transcript out from under a turn that is still writing to it.
	if (!tryLock(resume.id)) return json({ error: 'busy' }, { status: 409 });
	try {
		clearChat(resume.id);
	} finally {
		unlock(resume.id);
	}
	return json({ ok: true });
};

export const POST: RequestHandler = async ({ params, locals, request }) => {
	// Ownership first: an anonymous caller learns nothing about this server's
	// configuration, not even whether chat exists.
	const resume = requireOwnedResume(locals.user, Number(params.id));
	const user = locals.user!; // requireOwnedResume already rejected an anonymous caller.

	if (!config.agentConfigured) error(503, 'The chat assistant is not configured on this server.');

	const body = await request.json().catch(() => null);
	const raw = (body as { message?: unknown } | null)?.message;
	const message = typeof raw === 'string' ? raw.trim() : '';

	if (!message) return json({ error: 'Say something first.' }, { status: 400 });
	if (message.length > config.maxChatMessageChars) {
		return json(
			{ error: `That message is too long (max ${config.maxChatMessageChars} characters).` },
			{ status: 400 }
		);
	}

	// Cheapest check first, and it costs nothing to fail.
	const paced = burst.check(String(user.id));
	if (!paced.ok) {
		return json(
			{ error: 'You’re sending messages too quickly. Wait a moment.' },
			{ status: 429, headers: { 'retry-after': String(Math.ceil(paced.retryAfterMs / 1000)) } }
		);
	}

	// Lock next: being told "busy" should not cost the user a turn.
	if (!tryLock(resume.id)) {
		burst.refund(String(user.id));
		return json({ error: 'This résumé is already being edited.' }, { status: 409 });
	}

	let released = false;
	const release = () => {
		if (released) return;
		released = true;
		unlock(resume.id);
	};

	let quota;
	try {
		quota = reserveTurn(user.id);
	} catch (err) {
		release();
		throw err;
	}
	if (!quota.ok) {
		release();
		burst.refund(String(user.id));
		return json(
			{
				error:
					quota.reason === 'tokens'
						? "You've used today's chat budget. It resets at midnight UTC."
						: `You've used all ${quota.limit} chat turns for today. The limit resets at midnight UTC.`
			},
			{ status: 429 }
		);
	}

	appendChatMessage(resume.id, 'user', message);

	// Our own signal, not `request.signal`: under adapter-node the request signal
	// does not fire when the browser hangs up mid-stream — only the stream's
	// `cancel()` does. Link both so either one stops the model.
	const canceller = new AbortController();
	const stop = () => canceller.abort();
	request.signal.addEventListener('abort', stop, { once: true });

	const { events, finished } = runChatTurn({
		resume,
		userId: user.id,
		message,
		signal: canceller.signal
	});

	const encoder = new TextEncoder();
	const line = (ev: AgentEvent) => encoder.encode(`${JSON.stringify(ev)}\n`);

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			// Once the client is gone we keep draining the queue rather than
			// bailing out: the turn is still running, and its result still has to
			// be persisted and its lock released.
			let writable = true;

			try {
				for await (const ev of events) {
					if (!writable) continue;
					try {
						controller.enqueue(line(ev));
					} catch {
						writable = false; // The client hung up.
					}
				}
			} catch (err) {
				console.warn('[chat] stream failed for resume', resume.id, err);
			}

			try {
				const summary = await finished;
				// Persist even if nobody was listening — the reply is part of the
				// transcript, and the user will reload the page and expect it.
				if (summary.assistantText) appendChatMessage(resume.id, 'assistant', summary.assistantText);
				// Nothing was charged — bad credentials, a provider outage. Give the
				// turn back. A cancelled turn is not refunded: see TurnSummary.aborted.
				if (!summary.billed && !summary.aborted) refundTurn(user.id);
			} catch (err) {
				console.warn('[chat] turn failed for resume', resume.id, err);
			} finally {
				// Only now: `finished` has run finalizeTurn, so the résumé is no
				// longer mid-edit and a form save may safely take the lock.
				request.signal.removeEventListener('abort', stop);
				release();
				try {
					controller.close();
				} catch {
					// Already closed by a cancelled request.
				}
			}
		},
		cancel() {
			// The browser navigated away. Stop the model, but do NOT release the
			// lock here — the turn is still unwinding and may yet write to the
			// résumé. `start()` releases it once `finished` settles.
			stop();
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'application/x-ndjson; charset=utf-8',
			'cache-control': 'no-store, no-transform',
			// Don't let a reverse proxy sit on the stream.
			'x-accel-buffering': 'no'
		}
	});
};
