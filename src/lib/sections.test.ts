import { describe, expect, it } from 'vitest';
import { bulletSchema, sectionSchema, type Bullet, type Section } from '$lib/server/templates/schema';
import {
	SECTION_KINDS,
	bulletDate,
	bulletSub,
	bulletText,
	convertSection,
	hasSub,
	makeSection,
	withDate,
	withSub,
	withSubLines,
	withText,
	withoutSub,
	type SectionKind
} from './sections';

/** Parse against the real schema — the one `validateResumeData` uses. */
function assertValid(section: Section): Section {
	const parsed = sectionSchema.safeParse(section);
	if (!parsed.success) {
		throw new Error(`invalid ${section.kind}: ${JSON.stringify(parsed.error.issues, null, 1)}`);
	}
	return parsed.data;
}

/** One populated section of each kind, carrying a heading, a date and sub-lines. */
function populated(kind: SectionKind): Section {
	switch (kind) {
		case 'work':
			return {
				kind,
				title: 'Experience',
				page: 2,
				spaceAbove: 12,
				entries: [
					{
						timeframe: '2020–2024',
						title: 'Staff Engineer',
						titleNote: '',
						organization: 'Acme',
						location: 'Berlin',
						bullets: ['Shipped the thing', { text: 'Led the other thing', sub: ['detail'] }]
					}
				]
			};
		case 'bullets':
		case 'bullets-2col':
			return {
				kind,
				title: 'Skills',
				page: 1,
				fontSize: 9,
				bullets: [{ text: 'Rust', date: '2019', sub: ['async', 'macros'] }, 'Typst']
			};
		case 'exhibitions':
			return {
				kind,
				title: 'Shows',
				page: 2,
				entries: [{ title: 'Solo show', meta: 'Gallery X', date: '2023', items: [{ text: 'Room 1' }] }]
			};
	}
}

describe('bullet editing', () => {
	const valid = (b: Bullet) => expect(bulletSchema.safeParse(b).success).toBe(true);

	it('opens the sub-bullet editor and keeps it open while empty', () => {
		// The old implementation filtered the blank line away, left `sub`
		// undefined, and so the "+ sub-bullet" button silently did nothing.
		const opened = withSub('Plain bullet');
		expect(hasSub(opened)).toBe(true);
		expect(bulletSub(opened)).toEqual([]);
		expect(bulletText(opened)).toBe('Plain bullet');
		valid(opened);

		// Clearing every line must not slam the editor shut.
		const cleared = withSubLines(withSubLines(opened, 'one\ntwo'), '   \n  ');
		expect(hasSub(cleared)).toBe(true);
		expect(bulletSub(cleared)).toEqual([]);
		valid(cleared);
	});

	it('closes the editor and collapses back to a plain string', () => {
		const b = withSubLines(withSub('Text'), 'a\nb');
		expect(bulletSub(b)).toEqual(['a', 'b']);

		const closed = withoutSub(b);
		expect(hasSub(closed)).toBe(false);
		expect(closed).toBe('Text'); // a bare string again, not `{text: 'Text'}`
		valid(closed);
	});

	it('keeps the object form while a date survives', () => {
		const dated = withDate('Text', 'Jan. 2024');
		expect(dated).toEqual({ text: 'Text', date: 'Jan. 2024' });

		const withBoth = withSubLines(dated, 'a');
		expect(withoutSub(withBoth)).toEqual({ text: 'Text', date: 'Jan. 2024' });
		expect(withDate(withoutSub(withBoth), '')).toBe('Text');
	});

	it('trims, drops blanks, and caps sub-bullets at the schema’s ten', () => {
		const many = withSubLines('Text', Array.from({ length: 20 }, (_, i) => ` line ${i} `).join('\n'));
		expect(bulletSub(many)).toHaveLength(10);
		expect(bulletSub(many)[0]).toBe('line 0');
		valid(many);
	});

	it('edits text and date without disturbing the other', () => {
		let b: Bullet = 'Original';
		b = withText(b, 'Changed');
		expect(b).toBe('Changed');

		b = withDate(b, '2024');
		b = withText(b, 'Changed again');
		expect(bulletText(b)).toBe('Changed again');
		expect(bulletDate(b)).toBe('2024');
		valid(b);
	});
});

describe('makeSection', () => {
	it('produces a schema-valid empty section for every kind', () => {
		for (const kind of SECTION_KINDS) {
			const s = assertValid(makeSection(kind));
			expect(s.kind).toBe(kind);
			expect(s.page).toBe(1);
		}
	});
});

describe('convertSection', () => {
	it('is a no-op when the kind is unchanged', () => {
		for (const kind of SECTION_KINDS) {
			const s = populated(kind);
			expect(convertSection(s, kind)).toBe(s);
		}
	});

	it('produces a schema-valid section for every kind pair', () => {
		for (const from of SECTION_KINDS) {
			for (const to of SECTION_KINDS) {
				const converted = convertSection(populated(from), to);
				expect(converted.kind).toBe(to);
				assertValid(converted); // throws with the failing paths if not
			}
		}
	});

	it('preserves the section heading, page and spacing across every conversion', () => {
		for (const from of SECTION_KINDS) {
			for (const to of SECTION_KINDS) {
				const before = populated(from);
				const after = convertSection(before, to);
				expect(after.title).toBe(before.title);
				expect(after.page).toBe(before.page);
				expect(after.spaceAbove).toBe(before.spaceAbove);
			}
		}
	});

	it('carries the headings across, so switching kind by mistake loses nothing', () => {
		for (const from of SECTION_KINDS) {
			for (const to of SECTION_KINDS) {
				const after = convertSection(populated(from), to);
				const headings =
					after.kind === 'bullets' || after.kind === 'bullets-2col'
						? after.bullets.map(bulletText)
						: after.entries.map((e) => e.title);

				// Every source fixture's first row is its first heading.
				const expected =
					from === 'work' ? 'Staff Engineer' : from === 'exhibitions' ? 'Solo show' : 'Rust';
				expect(headings[0]).toBe(expected);
			}
		}
	});

	it('swapping between the two bullet kinds keeps the bullets and the font size', () => {
		const one = populated('bullets');
		const two = convertSection(one, 'bullets-2col');
		expect(two.kind).toBe('bullets-2col');
		if (two.kind !== 'bullets-2col') throw new Error('unreachable');
		expect(two.bullets).toEqual(one.kind === 'bullets' ? one.bullets : []);
		expect(two.fontSize).toBe(9);

		const back = convertSection(two, 'bullets');
		expect(back).toEqual(one);
	});

	it('turns a role’s bullets into sub-lines and back again', () => {
		const work = populated('work');
		const bullets = convertSection(work, 'bullets');
		if (bullets.kind !== 'bullets') throw new Error('unreachable');

		expect(bulletText(bullets.bullets[0])).toBe('Staff Engineer');
		expect(bulletSub(bullets.bullets[0])).toEqual(['Shipped the thing', 'Led the other thing']);

		const roundTrip = convertSection(bullets, 'work');
		if (roundTrip.kind !== 'work') throw new Error('unreachable');
		expect(roundTrip.entries[0].title).toBe('Staff Engineer');
		expect(roundTrip.entries[0].timeframe).toBe('2020–2024');
		expect(roundTrip.entries[0].bullets).toEqual(['Shipped the thing', 'Led the other thing']);
	});

	it('keeps a role’s prose body when there are no bullets', () => {
		const work: Section = {
			kind: 'work',
			title: 'Experience',
			page: 1,
			entries: [
				{ timeframe: '', title: 'Consultant', titleNote: '', organization: '', location: '', body: 'Prose here.' }
			]
		};
		const bullets = convertSection(work, 'bullets');
		if (bullets.kind !== 'bullets') throw new Error('unreachable');
		expect(bulletSub(bullets.bullets[0])).toEqual(['Prose here.']);
	});

	it('carries the organisation into the exhibition meta slot', () => {
		const shows = convertSection(populated('work'), 'exhibitions');
		if (shows.kind !== 'exhibitions') throw new Error('unreachable');
		expect(shows.entries[0].meta).toBe('Acme');
		expect(shows.entries[0].date).toBe('2020–2024');
		expect(shows.entries[0].items).toEqual([{ text: 'Shipped the thing' }, { text: 'Led the other thing' }]);
	});

	it('collapses a bullet with no date and no sub-lines back to a plain string', () => {
		const shows: Section = {
			kind: 'exhibitions',
			title: 'Shows',
			page: 1,
			entries: [{ title: 'Just a title' }]
		};
		const bullets = convertSection(shows, 'bullets');
		if (bullets.kind !== 'bullets') throw new Error('unreachable');
		expect(bullets.bullets[0]).toBe('Just a title');
	});

	it('drops rows past the schema’s caps rather than producing an invalid section', () => {
		const many: Section = {
			kind: 'bullets',
			title: 'Long',
			page: 1,
			bullets: Array.from({ length: 60 }, (_, i) => `bullet ${i}`)
		};
		const work = convertSection(many, 'work');
		if (work.kind !== 'work') throw new Error('unreachable');
		expect(work.entries).toHaveLength(30); // the schema's max
		assertValid(work);
	});

	it('never carries more than ten sub-lines onto one bullet', () => {
		const work: Section = {
			kind: 'work',
			title: 'Experience',
			page: 1,
			entries: [
				{
					timeframe: '',
					title: 'Role',
					titleNote: '',
					organization: '',
					location: '',
					bullets: Array.from({ length: 20 }, (_, i) => `line ${i}`)
				}
			]
		};
		const bullets = convertSection(work, 'bullets');
		if (bullets.kind !== 'bullets') throw new Error('unreachable');
		expect(bulletSub(bullets.bullets[0])).toHaveLength(10);
		assertValid(bullets);
	});
});
