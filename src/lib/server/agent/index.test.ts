import { beforeEach, describe, expect, it, vi } from 'vitest';

// Nothing here should reach Typst. If a test ever does, it's a bug in the test.
vi.mock('../compile', () => ({
	compileResume: vi.fn().mockResolvedValue({ ok: true, log: '', version: 1 }),
	resumeDir: vi.fn(),
	resumePdfPath: vi.fn()
}));

import { db } from '../db';
import { chatMessages, resumes, users, type Resume } from '../db/schema';
import { starterDefault } from '../templates/starter/default';
import { runChatTurn } from './index';
import type { AgentEvent } from './events';

function makeResume(templateId: string): { resume: Resume; userId: number } {
	const userId = db
		.insert(users)
		.values({ email: 'owner@example.com', googleSub: 'sub-owner' })
		.returning()
		.get().id;
	const resume = db
		.insert(resumes)
		.values({ userId, templateId, title: 'T', data: starterDefault })
		.returning()
		.get();
	return { resume, userId };
}

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
	const out: AgentEvent[] = [];
	for await (const ev of events) out.push(ev);
	return out;
}

beforeEach(() => {
	db.delete(chatMessages).run();
	db.delete(resumes).run();
	db.delete(users).run();
});

describe('runChatTurn setup failures', () => {
	/**
	 * A résumé can outlive its template — someone renames or drops one in a later
	 * deploy. `getTemplate()` then throws. That throw used to escape before the
	 * `try`, rejecting `finished`, so the route's `await finished` jumped straight
	 * past `refundTurn` and the user silently lost a turn to a server-side fault.
	 */
	it('reports a missing template as an error event instead of rejecting', async () => {
		const { resume, userId } = makeResume('a-template-that-was-deleted');
		const { events, finished } = runChatTurn({
			resume,
			userId,
			message: 'hello',
			signal: new AbortController().signal
		});

		const collected = await collect(events);
		// The contract `runChatTurn` advertises: `finished` never rejects.
		const summary = await expect(finished)
			.resolves.toBeDefined()
			.then(() => finished);

		expect(collected.some((e) => e.type === 'error')).toBe(true);
		expect(collected.some((e) => e.type === 'done')).toBe(false);

		// Nothing was spent, and the caller did not cancel — so the route refunds.
		expect(summary.billed).toBe(false);
		expect(summary.aborted).toBe(false);
		expect(summary.assistantText).toBe('');
	});

	it('does not leak the résumé or template name to the user', async () => {
		const { resume, userId } = makeResume('secret-internal-template');
		const { events, finished } = runChatTurn({
			resume,
			userId,
			message: 'hello',
			signal: new AbortController().signal
		});

		const collected = await collect(events);
		await finished;

		const errors = collected.filter((e): e is Extract<AgentEvent, { type: 'error' }> => e.type === 'error');
		expect(errors).toHaveLength(1);
		expect(errors[0].message).not.toContain('secret-internal-template');
	});

	it('resolves promptly when the caller has already aborted', async () => {
		const { resume, userId } = makeResume('starter');
		const ac = new AbortController();
		ac.abort();

		const { events, finished } = runChatTurn({ resume, userId, message: 'hello', signal: ac.signal });
		await collect(events);
		const summary = await finished;

		expect(summary.aborted).toBe(true);
		// An aborted turn is never refunded — see TurnSummary.aborted.
		expect(summary.assistantText).toBe('');
	}, 30_000);
});
