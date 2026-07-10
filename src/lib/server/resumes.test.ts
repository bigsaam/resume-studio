import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./compile', () => ({
	compileResume: vi.fn(),
	resumeDir: (id: number) => path.join(process.env.DATA_ROOT!, 'resumes', String(id)),
	resumePdfPath: vi.fn()
}));

import { eq } from 'drizzle-orm';
import { db } from './db';
import { chatMessages, resumes, users } from './db/schema';
import { starterDefault } from './templates/starter/default';
import { resumeDir } from './compile';
import { createResume, deleteResume, duplicateResume, setTitle, validateResumeData } from './resumes';
import { appendChatMessage, listChatMessages, setAgentSessionId } from './chat';

function makeUser(email = 'owner@example.com'): number {
	return db
		.insert(users)
		.values({ email, googleSub: `sub-${email}` })
		.returning()
		.get().id;
}

beforeEach(() => {
	db.delete(chatMessages).run();
	db.delete(resumes).run();
	db.delete(users).run();
});

describe('duplicateResume', () => {
	it('copies the content but not the conversation', () => {
		const uid = makeUser();
		const original = createResume({ userId: uid, templateId: 'starter', title: 'Mine' });
		setAgentSessionId(original.id, 'session-abc');
		appendChatMessage(original.id, 'user', 'tighten the bio');
		appendChatMessage(original.id, 'assistant', 'done');

		const fresh = db.select().from(resumes).where(eq(resumes.id, original.id)).get()!;
		const copy = duplicateResume(fresh);

		expect(copy.id).not.toBe(original.id);
		expect(copy.userId).toBe(uid);
		expect(copy.templateId).toBe('starter');
		expect(copy.data).toEqual(original.data);

		// A conversation belongs to the résumé it happened on. Handing the copy the
		// original's SDK session would let the agent "remember" a different document.
		expect(copy.agentSessionId).toBeNull();
		expect(listChatMessages(copy.id)).toHaveLength(0);
		expect(listChatMessages(original.id)).toHaveLength(2);

		// The copy has no PDF yet.
		expect(copy.renderVersion).toBe(0);
	});

	it('marks the copy in its title, and does not let the title grow forever', () => {
		const uid = makeUser();
		let current = createResume({ userId: uid, templateId: 'starter', title: 'x'.repeat(195) });

		for (let i = 0; i < 5; i++) {
			current = duplicateResume(current);
			expect(current.title.length).toBeLessThanOrEqual(200);
		}
		expect(current.title.startsWith('x'.repeat(195))).toBe(true);
	});

	it('leaves the original untouched', () => {
		const uid = makeUser();
		const original = createResume({ userId: uid, templateId: 'starter', title: 'Mine' });
		duplicateResume(original);

		const after = db.select().from(resumes).where(eq(resumes.id, original.id)).get()!;
		expect(after.title).toBe('Mine');
		expect(db.select().from(resumes).all()).toHaveLength(2);
	});
});

describe('deleteResume', () => {
	it('removes the rendered PDF beside the row', () => {
		const uid = makeUser();
		const resume = createResume({ userId: uid, templateId: 'starter' });

		const dir = resumeDir(resume.id);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, 'resume.pdf'), 'not really a pdf');

		deleteResume(resume.id);

		expect(db.select().from(resumes).all()).toHaveLength(0);
		expect(fs.existsSync(dir)).toBe(false);
	});

	it('does not fail when there is no PDF directory', () => {
		const uid = makeUser();
		const resume = createResume({ userId: uid, templateId: 'starter' });
		expect(() => deleteResume(resume.id)).not.toThrow();
	});

	it('takes the chat transcript with it', () => {
		const uid = makeUser();
		const resume = createResume({ userId: uid, templateId: 'starter' });
		appendChatMessage(resume.id, 'user', 'hello');

		deleteResume(resume.id);
		expect(db.select().from(chatMessages).all()).toHaveLength(0);
	});
});

describe('setTitle', () => {
	it('trims, caps, and falls back to a placeholder', () => {
		const uid = makeUser();
		const resume = createResume({ userId: uid, templateId: 'starter' });

		expect(setTitle(resume.id, '  Spaced  ')).toBe('Spaced');
		expect(setTitle(resume.id, '   ')).toBe('Untitled resume');
		expect(setTitle(resume.id, 'y'.repeat(500))).toHaveLength(200);
	});
});

describe('validateResumeData', () => {
	it('accepts the starter template’s own default', () => {
		expect(validateResumeData(starterDefault).ok).toBe(true);
	});

	it('rejects a blob past the byte ceiling before parsing it', () => {
		const huge = { ...starterDefault, header: { ...starterDefault.header, bio: 'x'.repeat(300_000) } };
		const result = validateResumeData(huge);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain('too large');
	});

	it('names the failing path', () => {
		const bad = structuredClone(starterDefault) as Record<string, unknown>;
		(bad.theme as Record<string, unknown>).nameSize = 999;
		const result = validateResumeData(bad);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain('theme.nameSize');
	});
});
