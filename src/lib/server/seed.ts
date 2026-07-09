import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import type { User } from './db/schema';
import { createResume, listResumes, validateResumeData } from './resumes';
import { compileResume } from './compile';
import { templates } from './templates';

/**
 * Pre-populate a person's first resume from `seed/<email>.json`.
 *
 * Seed files hold a real person's résumé and are gitignored — the repo is
 * public. Seeding fires only when the user has no resumes, so it can never
 * clobber existing work.
 */

interface SeedFile {
	templateId?: string;
	title?: string;
	data: unknown;
}

function seedPathFor(email: string): string | null {
	// The email comes from a verified id_token, but it ends up in a filename —
	// refuse anything that could climb out of the seed directory.
	if (!email || email.includes('/') || email.includes('\\') || email.includes('..')) return null;
	const full = path.resolve(config.seedDir, `${email.toLowerCase()}.json`);
	const rel = path.relative(config.seedDir, full);
	if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
	return full;
}

export function maybeSeedForUser(user: User): void {
	try {
		if (listResumes(user.id).length > 0) return;

		const file = seedPathFor(user.email);
		if (!file || !fs.existsSync(file)) return;

		const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as SeedFile;
		// Allow either `{ data: {...} }` or a bare resume blob.
		const rawData = parsed && typeof parsed === 'object' && 'data' in parsed ? parsed.data : parsed;

		const result = validateResumeData(rawData);
		if (!result.ok) {
			console.warn(`[seed] ${file} failed validation, skipping:\n${result.error}`);
			return;
		}

		const templateId = parsed.templateId && templates[parsed.templateId] ? parsed.templateId : 'typographic';
		const resume = createResume({
			userId: user.id,
			templateId,
			title: parsed.title ?? 'My Resume',
			data: result.data
		});

		// Render in the background; the resumes list works without it.
		void compileResume(resume.id);
		console.log(`[seed] created resume ${resume.id} for user ${user.id} from ${path.basename(file)}`);
	} catch (err) {
		// Seeding must never block a login.
		console.warn('[seed] failed:', err instanceof Error ? err.message : err);
	}
}
