import { z } from 'zod';

/**
 * The resume data contract.
 *
 * This is the single shape that the structured form editor, the chat agent's
 * `edit_resume` tool, and the Typst templates all agree on. It is validated on
 * every write — nothing reaches the renderer unvalidated.
 *
 * Content strings may carry a little Typst markup (`*bold*`, `--` en dash,
 * `#link("url")[text]`); templates render them through `eval(.., mode: "markup")`.
 * That is why every compile runs inside a throwaway Typst root containing only
 * this user's own data — see `lib/server/compile.ts`.
 *
 * Array lengths are capped so a valid-but-enormous blob can't drive a
 * pathological Typst layout.
 */

const HEX = /^#[0-9a-fA-F]{6}$/;
const hex = z.string().regex(HEX, 'must be a #RRGGBB hex color');

/** Opaque asset id (see the `assets` table). Never a filesystem path. */
const assetId = z
	.string()
	.regex(/^[A-Za-z0-9_-]{1,64}$/, 'must be an asset id')
	.optional()
	.or(z.literal(''));

const markup = z.string().max(4_000);
const short = z.string().max(300);

/** A bullet is either a plain string, or an object with a right-aligned date. */
export const bulletSchema = z.union([
	markup,
	z.object({
		text: markup,
		date: short.optional(),
		sub: z.array(markup).max(10).optional()
	})
]);

const themeSchema = z.object({
	colors: z.object({
		text: hex,
		heading: hex,
		name: hex,
		sidebar: hex
	}),
	fonts: z.object({
		body: short,
		secondary: short,
		heading: short,
		/** Optional so the name can keep a different face from the body stack. */
		name: short.optional()
	}),
	nameSize: z.number().min(6).max(72),
	bodySize: z.number().min(5).max(24).optional(),
	photoWidthPct: z.number().min(10).max(100),
	photoBorderColor: hex,
	photoBorderWidth: z.number().min(0).max(20)
});

const headerSchema = z.object({
	firstName: short,
	lastName: short,
	profession: short,
	bio: markup,
	/** Optional: templates must render cleanly with no photo. */
	photo: assetId,
	photoCaption: short.optional().default('')
});

const contactSchema = z.object({
	icon: z.enum(['email', 'instagram', 'phone', 'website', 'github']),
	text: short,
	href: short
});

const educationSchema = z.object({
	logo: assetId,
	logoWidth: z.number().min(4).max(120).default(30),
	date: short.optional(),
	lines: z.array(markup).min(1).max(8)
});

const languageSchema = z.object({ language: short, level: short });

const sectionBase = {
	id: z.string().max(64).optional(),
	title: short,
	page: z.union([z.literal(1), z.literal(2)]),
	spaceAbove: z.number().min(0).max(200).optional()
};

const workEntrySchema = z.object({
	timeframe: short.optional().default(''),
	title: short,
	titleNote: short.optional().default(''),
	organization: short.optional().default(''),
	location: short.optional().default(''),
	spaceAbove: z.number().min(0).max(200).optional(),
	bullets: z.array(bulletSchema).max(40).optional(),
	/** Alternative to `bullets` for a single prose paragraph. */
	body: markup.optional()
});

const exhibitionEntrySchema = z.object({
	title: markup,
	meta: markup.optional(),
	date: short.optional(),
	items: z
		.array(z.object({ text: markup, date: short.optional(), sub: z.array(markup).max(10).optional() }))
		.max(20)
		.optional()
});

export const sectionSchema = z.discriminatedUnion('kind', [
	z.object({ ...sectionBase, kind: z.literal('work'), entries: z.array(workEntrySchema).max(30) }),
	z.object({
		...sectionBase,
		kind: z.literal('bullets'),
		fontSize: z.number().min(5).max(24).optional(),
		/** Keep the section from splitting across a page break. */
		wrapWhole: z.boolean().optional(),
		bullets: z.array(bulletSchema).max(60)
	}),
	z.object({
		...sectionBase,
		kind: z.literal('bullets-2col'),
		fontSize: z.number().min(5).max(24).optional(),
		bullets: z.array(bulletSchema).max(60)
	}),
	z.object({
		...sectionBase,
		kind: z.literal('exhibitions'),
		entries: z.array(exhibitionEntrySchema).max(30)
	})
]);

export const resumeDataSchema = z.object({
	theme: themeSchema,
	header: headerSchema,
	contact: z.array(contactSchema).max(8),
	education: z.array(educationSchema).max(10),
	languages: z.array(languageSchema).max(10),
	hobbies: z.array(short).max(15).optional(),
	sections: z.array(sectionSchema).max(15)
});

export type ResumeData = z.infer<typeof resumeDataSchema>;
export type Bullet = z.infer<typeof bulletSchema>;
export type Section = z.infer<typeof sectionSchema>;

/** Flatten a ZodError into something an agent or a form can act on. */
export function formatZodError(err: z.ZodError): string {
	return err.issues
		.slice(0, 20)
		.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
		.join('\n');
}
