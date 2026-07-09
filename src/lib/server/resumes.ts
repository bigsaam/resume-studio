import { desc, eq } from 'drizzle-orm';
import { db } from './db';
import { resumes, type Resume } from './db/schema';
import { getTemplate } from './templates';
import { resumeDataSchema, formatZodError, type ResumeData } from './templates/schema';
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

export function deleteResume(resumeId: number): void {
	db.delete(resumes).where(eq(resumes.id, resumeId)).run();
}

export type ValidationResult =
	| { ok: true; data: ResumeData }
	| { ok: false; error: string };

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

export function setTitle(resumeId: number, title: string): void {
	db.update(resumes)
		.set({ title: title.trim() || 'Untitled resume', updatedAt: new Date() })
		.where(eq(resumes.id, resumeId))
		.run();
}

/**
 * Roll back to the last blob that compiled. Returns false when there's nothing
 * to roll back to (a resume whose very first compile failed).
 */
export function revertToLastGood(resumeId: number): boolean {
	const row = db.select().from(resumes).where(eq(resumes.id, resumeId)).get();
	if (!row?.lastGoodJson) return false;
	db.update(resumes).set({ data: row.lastGoodJson, updatedAt: new Date() }).where(eq(resumes.id, resumeId)).run();
	return true;
}
