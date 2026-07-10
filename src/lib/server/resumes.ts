import fs from 'node:fs';
import { desc, eq } from 'drizzle-orm';
import { db } from './db';
import { resumes, type Resume } from './db/schema';
import { getTemplate } from './templates';
import { resumeDataSchema, formatZodError, type ResumeData } from './templates/schema';
import { resumeDir } from './compile';
import { config } from './config';

export function listResumes(userId: number): Resume[] {
	return db.select().from(resumes).where(eq(resumes.userId, userId)).orderBy(desc(resumes.updatedAt)).all();
}

export function createResume(opts: {
	userId: number;
	templateId: string;
	title?: string;
	data?: ResumeData;
}): Resume {
	const template = getTemplate(opts.templateId);
	const data = opts.data ?? template.defaultData;
	return db
		.insert(resumes)
		.values({
			userId: opts.userId,
			templateId: template.id,
			title: opts.title?.trim() || 'Untitled resume',
			data,
			lastGoodJson: null
		})
		.returning()
		.get();
}

/** Cap a title so it can't grow without bound through repeated duplication. */
const MAX_TITLE = 200;

/**
 * Copy a résumé for the same owner.
 *
 * Deliberately does **not** carry over `agentSessionId`: a conversation belongs
 * to the résumé it happened on, and handing the copy the original's SDK session
 * would let the agent "remember" edits to a document it is no longer looking at.
 * The chat transcript isn't copied either — `chat_messages` is keyed by resume id.
 *
 * `renderVersion` restarts at 0 because the copy has no PDF on disk yet.
 */
export function duplicateResume(source: Resume): Resume {
	return db
		.insert(resumes)
		.values({
			userId: source.userId,
			templateId: source.templateId,
			title: `${source.title} (copy)`.slice(0, MAX_TITLE),
			data: source.data,
			lastGoodJson: source.lastGoodJson,
			renderVersion: 0,
			agentSessionId: null
		})
		.returning()
		.get();
}

/**
 * Drop the row and the rendered PDF beside it. `chat_messages` goes with it via
 * `ON DELETE CASCADE`; uploaded assets do not, because they belong to the user
 * and another résumé may still reference them.
 */
export function deleteResume(resumeId: number): void {
	db.delete(resumes).where(eq(resumes.id, resumeId)).run();
	fs.rmSync(resumeDir(resumeId), { recursive: true, force: true });
}

export type ValidationResult = { ok: true; data: ResumeData } | { ok: false; error: string };

/** Validate an untrusted blob against the schema, with a size ceiling. */
export function validateResumeData(raw: unknown): ValidationResult {
	const bytes = Buffer.byteLength(JSON.stringify(raw ?? null));
	if (bytes > config.maxResumeBytes) {
		return { ok: false, error: `Resume is too large (${bytes} bytes, max ${config.maxResumeBytes}).` };
	}
	const parsed = resumeDataSchema.safeParse(raw);
	if (!parsed.success) return { ok: false, error: formatZodError(parsed.error) };
	return { ok: true, data: parsed.data };
}

export function writeResumeData(resumeId: number, data: ResumeData): void {
	db.update(resumes).set({ data, updatedAt: new Date() }).where(eq(resumes.id, resumeId)).run();
}

export function setTitle(resumeId: number, title: string): string {
	const clean = title.trim().slice(0, MAX_TITLE) || 'Untitled resume';
	db.update(resumes).set({ title: clean, updatedAt: new Date() }).where(eq(resumes.id, resumeId)).run();
	return clean;
}

/**
 * Roll back to the last blob that compiled. Returns false when there's nothing
 * to roll back to (a resume whose very first compile failed).
 */
export function revertToLastGood(resumeId: number): boolean {
	const row = db.select().from(resumes).where(eq(resumes.id, resumeId)).get();
	if (!row?.lastGoodJson) return false;
	db.update(resumes)
		.set({ data: row.lastGoodJson, updatedAt: new Date() })
		.where(eq(resumes.id, resumeId))
		.run();
	return true;
}
