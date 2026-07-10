import type { Bullet, Section } from '$lib/server/templates/schema';

/**
 * Creating and converting résumé sections.
 *
 * `Section` is a discriminated union on `kind`, so changing a section's kind
 * means building a new object, not assigning a field. The interesting part is
 * that the four kinds hold overlapping information in different shapes, and a
 * user who picks the wrong kind should be able to change their mind without
 * losing what they typed.
 *
 * So every conversion carries content across rather than starting empty:
 * an entry's title becomes a bullet's text, its bullets become that bullet's
 * sub-lines, and so on. Nothing here validates — `validateResumeData` does that
 * on the way to the database — but `sections.test.ts` asserts that every
 * conversion of every kind still satisfies `sectionSchema`.
 */

export const SECTION_KINDS = ['work', 'bullets', 'bullets-2col', 'exhibitions'] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

export const KIND_LABELS: Record<SectionKind, string> = {
	work: 'Roles',
	bullets: 'Bullets',
	'bullets-2col': 'Bullets, two columns',
	exhibitions: 'Exhibitions'
};

/* ------------------------------------------------------------- bullet bits */

export function bulletText(b: Bullet): string {
	return typeof b === 'string' ? b : b.text;
}

export function bulletDate(b: Bullet): string {
	return typeof b === 'string' ? '' : (b.date ?? '');
}

export function bulletSub(b: Bullet): string[] {
	return typeof b === 'string' ? [] : (b.sub ?? []);
}

/** Collapse to a plain string when there's nothing else to carry. */
function makeBullet(text: string, date: string, sub: string[]): Bullet {
	if (!date && sub.length === 0) return text;
	return {
		text,
		...(date ? { date } : {}),
		...(sub.length ? { sub: sub.slice(0, 10) } : {})
	};
}

/* --------------------------------------------------------- bullet editing */

/**
 * Whether the sub-bullet editor should be open for this bullet.
 *
 * Keyed off the *presence* of `sub`, not its length. An index-keyed "expanded"
 * set in the component would follow the wrong row once the list is reordered,
 * and a length check would slam the editor shut the moment the last line was
 * cleared — which is exactly what the old `setSub(i, ' ')` did, making the
 * "+ sub-bullet" button do nothing at all.
 */
export function hasSub(b: Bullet): boolean {
	return typeof b === 'object' && b.sub !== undefined;
}

function asObject(b: Bullet): Exclude<Bullet, string> {
	return typeof b === 'string' ? { text: b } : b;
}

/** Collapse back to a plain string once nothing but text is left. */
function normalize(b: Exclude<Bullet, string>): Bullet {
	if (b.date === undefined && b.sub === undefined) return b.text;
	return b;
}

export function withText(b: Bullet, text: string): Bullet {
	return typeof b === 'string' ? text : { ...b, text };
}

export function withDate(b: Bullet, date: string): Bullet {
	return normalize({ ...asObject(b), date: date === '' ? undefined : date });
}

/** Open the sub-bullet editor. The empty array is what keeps it open. */
export function withSub(b: Bullet): Bullet {
	return { ...asObject(b), sub: [] };
}

export function withoutSub(b: Bullet): Bullet {
	return normalize({ ...asObject(b), sub: undefined });
}

/** Replace the sub-bullets from a textarea's contents, keeping the editor open. */
export function withSubLines(b: Bullet, raw: string): Bullet {
	const lines = raw
		.split('\n')
		.map((s) => s.trim())
		.filter(Boolean);
	return { ...asObject(b), sub: lines.slice(0, 10) };
}

/** A work entry's lines: its bullets, or its prose body if it has one instead. */
function workEntryLines(entry: Extract<Section, { kind: 'work' }>['entries'][number]): string[] {
	if (entry.bullets?.length) return entry.bullets.map(bulletText);
	return entry.body ? [entry.body] : [];
}

/* ------------------------------------------------------------ construction */

const base = (title: string, page: 1 | 2) => ({ title, page });

export function makeSection(kind: SectionKind, title = 'New section', page: 1 | 2 = 1): Section {
	switch (kind) {
		case 'work':
			return { ...base(title, page), kind, entries: [] };
		case 'bullets':
			return { ...base(title, page), kind, bullets: [] };
		case 'bullets-2col':
			return { ...base(title, page), kind, bullets: [] };
		case 'exhibitions':
			return { ...base(title, page), kind, entries: [] };
	}
}

/* -------------------------------------------------------------- extraction */

/**
 * The lowest common denominator every kind can be projected onto and rebuilt
 * from: a heading, an optional right-aligned date, and some sub-lines.
 */
interface Row {
	text: string;
	date: string;
	sub: string[];
}

function toRows(section: Section): Row[] {
	switch (section.kind) {
		case 'work':
			return section.entries.map((e) => ({
				text: e.title,
				date: e.timeframe || '',
				sub: workEntryLines(e)
			}));
		case 'bullets':
		case 'bullets-2col':
			return section.bullets.map((b) => ({
				text: bulletText(b),
				date: bulletDate(b),
				sub: bulletSub(b)
			}));
		case 'exhibitions':
			return section.entries.map((e) => ({
				text: e.title,
				date: e.date || '',
				sub: (e.items ?? []).map((i) => i.text)
			}));
	}
}

/** The organisation/meta line, which only two of the kinds have a slot for. */
function metaOf(section: Section, index: number): string {
	if (section.kind === 'work') {
		const e = section.entries[index];
		return e?.organization || e?.location || '';
	}
	if (section.kind === 'exhibitions') return section.entries[index]?.meta ?? '';
	return '';
}

/* -------------------------------------------------------------- conversion */

/**
 * Rebuild a section under a new kind, carrying as much across as the target
 * shape can hold. Returns the same object when the kind is unchanged.
 *
 * Caps are the schema's: 30 entries for `work` and `exhibitions`, 60 bullets.
 * Anything past them would fail validation, so it is dropped here rather than
 * rejected later.
 */
export function convertSection(section: Section, kind: SectionKind): Section {
	if (section.kind === kind) return section;

	// The two bullet kinds are the same shape; swapping between them is a rename.
	if (
		(section.kind === 'bullets' && kind === 'bullets-2col') ||
		(section.kind === 'bullets-2col' && kind === 'bullets')
	) {
		return { ...section, kind };
	}

	const rows = toRows(section);
	const common = {
		...(section.id !== undefined ? { id: section.id } : {}),
		title: section.title,
		page: section.page,
		...(section.spaceAbove !== undefined ? { spaceAbove: section.spaceAbove } : {})
	};

	switch (kind) {
		case 'work':
			return {
				...common,
				kind,
				entries: rows.slice(0, 30).map((r, i) => ({
					timeframe: r.date,
					title: r.text,
					titleNote: '',
					organization: metaOf(section, i),
					location: '',
					bullets: r.sub
				}))
			};

		case 'bullets':
		case 'bullets-2col': {
			const fontSize = 'fontSize' in section ? section.fontSize : undefined;
			return {
				...common,
				kind,
				...(fontSize !== undefined ? { fontSize } : {}),
				bullets: rows.slice(0, 60).map((r) => makeBullet(r.text, r.date, r.sub))
			};
		}

		case 'exhibitions':
			return {
				...common,
				kind,
				entries: rows.slice(0, 30).map((r, i) => ({
					title: r.text,
					meta: metaOf(section, i),
					date: r.date,
					items: r.sub.map((text) => ({ text }))
				}))
			};
	}
}
