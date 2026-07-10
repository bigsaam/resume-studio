import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

// `compileResume` shells out to Typst. The repair/revert logic is what's under
// test here, so drive the compiler's verdict directly.
vi.mock('../compile', () => ({
	compileResume: vi.fn(),
	resumeDir: vi.fn(),
	resumePdfPath: vi.fn()
}));

import { compileResume } from '../compile';
import { db } from '../db';
import { chatMessages, resumes, users } from '../db/schema';
import { starterDefault } from '../templates/starter/default';
import type { ResumeData } from '../templates/schema';
import { EventQueue, type AgentEvent } from './events';
import { buildResumeTools, finalizeTurn, newTurnState, type ToolContext } from './tools';

const mockCompile = vi.mocked(compileResume);

/** `CallToolResult.content` is a union of text/image/audio blocks. */
function textOf(res: { content: Array<Record<string, unknown>> }): string {
	const first = res.content[0];
	return first && typeof first.text === 'string' ? first.text : '';
}

/** Compiler says yes, bumping the render version like the real one does. */
function compilesOk(version = 1) {
	mockCompile.mockResolvedValue({ ok: true, log: '', version });
}
function compileFails(log = 'error: unclosed delimiter') {
	mockCompile.mockResolvedValue({ ok: false, log, version: 0 });
}

function makeUser(email: string): number {
	return db.insert(users).values({ email, googleSub: `sub-${email}` }).returning().get().id;
}

function makeResume(userId: number, data: ResumeData = starterDefault, lastGood: ResumeData | null = null) {
	return db
		.insert(resumes)
		.values({ userId, templateId: 'starter', title: 'T', data, lastGoodJson: lastGood })
		.returning()
		.get();
}

function makeCtx(userId: number, resumeId: number): ToolContext & { drained: () => AgentEvent[] } {
	const events = new EventQueue<AgentEvent>();
	const seen: AgentEvent[] = [];
	const realPush = events.push.bind(events);
	events.push = (e: AgentEvent) => {
		seen.push(e);
		realPush(e);
	};
	return { userId, resumeId, state: newTurnState(0), events, drained: () => seen };
}

/** A structurally valid document that differs from the default. */
function editedDoc(bio: string): Record<string, unknown> {
	return structuredClone({ ...starterDefault, header: { ...starterDefault.header, bio } }) as Record<
		string,
		unknown
	>;
}

const storedBio = (id: number) => db.select().from(resumes).where(eq(resumes.id, id)).get()!.data.header.bio;

beforeEach(() => {
	vi.clearAllMocks();
	db.delete(chatMessages).run();
	db.delete(resumes).run();
	db.delete(users).run();
	compilesOk();
});

describe('get_resume', () => {
	it('returns the caller’s résumé', async () => {
		const uid = makeUser('owner@example.com');
		const r = makeResume(uid);
		const ctx = makeCtx(uid, r.id);

		const res = await buildResumeTools(ctx).getResume.handler({}, {});
		expect(res.isError).toBeFalsy();
		expect(JSON.parse(textOf(res)).data.header.firstName).toBe(starterDefault.header.firstName);
	});

	it('refuses another user’s résumé even when the id is right', async () => {
		const owner = makeUser('owner@example.com');
		const attacker = makeUser('attacker@example.com');
		const r = makeResume(owner);

		// The route would have 404'd, but the tool must not rely on that.
		const ctx = makeCtx(attacker, r.id);
		const res = await buildResumeTools(ctx).getResume.handler({}, {});

		expect(res.isError).toBe(true);
		expect(textOf(res)).toContain('not found');
	});
});

describe('edit_resume', () => {
	it('persists a valid document', async () => {
		const uid = makeUser('owner@example.com');
		const r = makeResume(uid);
		const ctx = makeCtx(uid, r.id);

		const res = await buildResumeTools(ctx).editResume.handler({ data: editedDoc('New bio') }, {});

		expect(res.isError).toBeFalsy();
		expect(storedBio(r.id)).toBe('New bio');
		expect(ctx.state.dirty).toBe(true);
		expect(ctx.state.edited).toBe(true);
	});

	it('rejects a document that fails the schema, saving nothing', async () => {
		const uid = makeUser('owner@example.com');
		const r = makeResume(uid);
		const ctx = makeCtx(uid, r.id);

		const bad = editedDoc('Bio');
		(bad.theme as Record<string, unknown>).colors = { text: 'not-a-hex', heading: '#000000' };

		const res = await buildResumeTools(ctx).editResume.handler({ data: bad }, {});

		expect(res.isError).toBe(true);
		expect(textOf(res)).toContain('theme.colors.text');
		expect(storedBio(r.id)).toBe(starterDefault.header.bio);
		expect(ctx.state.dirty).toBe(false);
	});

	it('will not write to another user’s résumé', async () => {
		const owner = makeUser('owner@example.com');
		const attacker = makeUser('attacker@example.com');
		const r = makeResume(owner);
		const ctx = makeCtx(attacker, r.id);

		const res = await buildResumeTools(ctx).editResume.handler({ data: editedDoc('pwned') }, {});

		expect(res.isError).toBe(true);
		expect(storedBio(r.id)).toBe(starterDefault.header.bio);
	});

	it('strips unknown keys rather than persisting them', async () => {
		const uid = makeUser('owner@example.com');
		const r = makeResume(uid);
		const ctx = makeCtx(uid, r.id);

		const doc = editedDoc('Bio');
		doc.__proto__x = 'nope';
		doc.somethingElse = { a: 1 };

		await buildResumeTools(ctx).editResume.handler({ data: doc }, {});

		const stored = db.select().from(resumes).where(eq(resumes.id, r.id)).get()!.data as Record<string, unknown>;
		expect(stored.somethingElse).toBeUndefined();
		expect(stored.__proto__x).toBeUndefined();
	});
});

describe('render_resume repair loop', () => {
	it('reports success and clears the dirty flag', async () => {
		const uid = makeUser('owner@example.com');
		const r = makeResume(uid);
		const ctx = makeCtx(uid, r.id);
		ctx.state.dirty = true;
		compilesOk(7);

		const res = await buildResumeTools(ctx).renderResume.handler({}, {});

		expect(res.isError).toBeFalsy();
		expect(ctx.state.dirty).toBe(false);
		expect(ctx.state.version).toBe(7);
		expect(ctx.drained()).toContainEqual({ type: 'render', ok: true, version: 7, reverted: false });
	});

	it('gives the model two repair attempts, then reverts on the third failure', async () => {
		const uid = makeUser('owner@example.com');
		const good: ResumeData = structuredClone(starterDefault);
		const r = makeResume(uid, structuredClone(starterDefault), good);
		const ctx = makeCtx(uid, r.id);

		// The agent breaks the résumé.
		await buildResumeTools(ctx).editResume.handler({ data: editedDoc('#broken(') }, {});
		expect(storedBio(r.id)).toBe('#broken(');

		compileFails();
		const tools = buildResumeTools(ctx);

		const first = await tools.renderResume.handler({}, {});
		expect(first.isError).toBe(true);
		expect(textOf(first)).toContain('2 attempts left');
		expect(ctx.state.reverted).toBe(false);

		const second = await tools.renderResume.handler({}, {});
		expect(textOf(second)).toContain('1 attempt left');
		expect(ctx.state.reverted).toBe(false);
		// Still broken on disk — nothing rolled back yet.
		expect(storedBio(r.id)).toBe('#broken(');

		// Third failure: roll back to last_good_json and rebuild.
		mockCompile.mockResolvedValueOnce({ ok: false, log: 'boom', version: 0 });
		mockCompile.mockResolvedValueOnce({ ok: true, log: '', version: 9 });
		const third = await tools.renderResume.handler({}, {});

		expect(third.isError).toBe(true);
		expect(textOf(third)).toContain('rolled back');
		expect(ctx.state.reverted).toBe(true);
		expect(storedBio(r.id)).toBe(good.header.bio);
		expect(ctx.state.dirty).toBe(false);
	});

	it('says so when there is no good version to roll back to', async () => {
		const uid = makeUser('owner@example.com');
		const r = makeResume(uid, structuredClone(starterDefault), null); // never compiled
		const ctx = makeCtx(uid, r.id);
		compileFails('error: bad');

		const tools = buildResumeTools(ctx);
		await tools.renderResume.handler({}, {});
		await tools.renderResume.handler({}, {});
		const third = await tools.renderResume.handler({}, {});

		expect(third.isError).toBe(true);
		expect(textOf(third)).toContain('no working version');
		expect(ctx.state.reverted).toBe(false);
	});
});

describe('finalizeTurn', () => {
	it('does nothing when the turn made no unproven edit', async () => {
		const uid = makeUser('owner@example.com');
		const r = makeResume(uid);
		const ctx = makeCtx(uid, r.id);

		await finalizeTurn(ctx);
		expect(mockCompile).not.toHaveBeenCalled();
	});

	it('compiles an edit the model never rendered', async () => {
		const uid = makeUser('owner@example.com');
		const r = makeResume(uid);
		const ctx = makeCtx(uid, r.id);
		ctx.state.dirty = true;
		compilesOk(4);

		await finalizeTurn(ctx);

		expect(mockCompile).toHaveBeenCalledOnce();
		expect(ctx.state.version).toBe(4);
		expect(ctx.state.reverted).toBe(false);
	});

	it('reverts an edit the model left broken and never rendered', async () => {
		const uid = makeUser('owner@example.com');
		const good: ResumeData = structuredClone(starterDefault);
		const r = makeResume(uid, structuredClone(starterDefault), good);
		const ctx = makeCtx(uid, r.id);

		await buildResumeTools(ctx).editResume.handler({ data: editedDoc('#broken(') }, {});
		expect(ctx.state.dirty).toBe(true);

		mockCompile.mockResolvedValueOnce({ ok: false, log: 'boom', version: 0 }); // safety-net compile
		mockCompile.mockResolvedValueOnce({ ok: true, log: '', version: 3 }); // rebuild after revert

		await finalizeTurn(ctx);

		expect(storedBio(r.id)).toBe(good.header.bio);
		expect(ctx.state.reverted).toBe(true);
		expect(ctx.state.dirty).toBe(false);
	});
});
