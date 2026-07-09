import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { error } from '@sveltejs/kit';
import { resumeDataSchema, type ResumeData } from './schema';
import { typographicDefault } from './typographic/default';
import { starterDefault } from './starter/default';

/**
 * A template is a Typst entry file plus the generic assets it references, the
 * schema its data must satisfy, and the content a brand-new resume starts with.
 *
 * Adding a template: drop a directory containing `main.typ` (+ optional
 * `assets/`) and a `default.ts`, then add one entry to `templates` below.
 */
export interface TemplateDef {
	id: string;
	name: string;
	description: string;
	/** Absolute path to the Typst entry file. Copied into each compile root. */
	entryFile: string;
	/** Absolute path to generic assets (icons/logos) copied in alongside. */
	assetsDir: string;
	schema: typeof resumeDataSchema;
	defaultData: ResumeData;
}

// `import.meta.url` keeps this correct in dev and after the adapter bundles.
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = (id: string) => path.join(here, id);

export const templates: Record<string, TemplateDef> = {
	typographic: {
		id: 'typographic',
		name: 'Typographic',
		description:
			'Two pages. A tinted sidebar carries contact, education and languages beside a main column; later pages run full width. Optional circular photo.',
		entryFile: path.join(dir('typographic'), 'main.typ'),
		assetsDir: path.join(dir('typographic'), 'assets'),
		schema: resumeDataSchema,
		defaultData: typographicDefault
	},
	starter: {
		id: 'starter',
		name: 'Starter',
		description:
			'One column, full width, no photo. A plain page to start from — good for engineering and academic resumes.',
		entryFile: path.join(dir('starter'), 'main.typ'),
		assetsDir: path.join(dir('starter'), 'assets'),
		schema: resumeDataSchema,
		defaultData: starterDefault
	}
};

export const templateList = Object.values(templates);

export function getTemplate(id: string): TemplateDef {
	const t = templates[id];
	if (!t) error(400, `Unknown template: ${id}`);
	return t;
}

export { resumeDataSchema };
export type { ResumeData };
