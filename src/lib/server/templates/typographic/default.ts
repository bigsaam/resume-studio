import type { ResumeData } from '../schema';

/**
 * Starting content for a new `typographic` resume.
 *
 * Entirely fictional. Nothing here may reference a real person — this file is
 * committed to a public repo.
 */
export const typographicDefault: ResumeData = {
	theme: {
		colors: {
			text: '#4b4032',
			heading: '#4f6b3e',
			name: '#4f6b3e',
			sidebar: '#d5e0c5'
		},
		fonts: {
			body: 'Nunito Sans',
			secondary: 'Nunito Sans',
			heading: 'Nunito Sans',
			name: 'Libre Baskerville'
		},
		nameSize: 26,
		bodySize: 8,
		photoWidthPct: 82,
		photoBorderColor: '#4f6b3e',
		photoBorderWidth: 2.5
	},
	header: {
		firstName: 'Alex',
		lastName: 'Rivera',
		profession: 'Designer | Educator | Maker',
		bio: 'Designer and educator working at the intersection of craft and technology. I build tools that make hard things approachable, and teach the people who use them.',
		photo: '',
		// Shown under the photo. Left empty until a photo is uploaded.
		photoCaption: ''
	},
	contact: [
		{ icon: 'email', text: 'alex@example.com', href: 'mailto:alex@example.com' },
		{ icon: 'website', text: 'alexrivera.example', href: 'https://alexrivera.example' },
		{ icon: 'phone', text: '555-0100', href: 'tel:+15550100' }
	],
	education: [
		{
			logo: '',
			logoWidth: 30,
			date: 'Jun. 2016',
			lines: ['*Bachelor of Arts*', 'Design & Visual Communication', 'Example State University']
		},
		{
			logo: '',
			logoWidth: 30,
			date: 'Apr. 2014',
			lines: ['*Associate Diploma*', 'Studio Art', 'Example Community College']
		}
	],
	languages: [
		{ language: 'English', level: 'Fluent' },
		{ language: 'Spanish', level: 'Conversational' }
	],
	hobbies: ['Letterpress', 'Trail running', 'Bread'],
	sections: [
		{
			id: 'work',
			title: 'Work Experience',
			kind: 'work',
			page: 1,
			spaceAbove: 0,
			entries: [
				{
					timeframe: 'Mar. 2021 - Present',
					title: 'Senior Product Designer',
					titleNote: '',
					organization: 'Example Labs',
					location: 'Remote',
					spaceAbove: 0,
					bullets: [
						// Avoid `~` here — Typst reads it as a non-breaking space.
						'Lead design for a developer platform used by 40k engineers monthly',
						'Built and maintain the design system adopted across six product teams',
						'Run a weekly critique that raised design-review throughput by roughly a third'
					]
				},
				{
					timeframe: 'Sep. 2017 - Feb. 2021',
					title: 'Design Lead',
					titleNote: 'Ages 12-18',
					organization: 'Example Studio',
					location: 'Portland, OR',
					spaceAbove: 9,
					bullets: [
						'Designed and taught a project-based curriculum for teen makers',
						'Hired, trained & mentored a team of four teaching artists'
					]
				},
				{
					timeframe: 'Jun. 2016 - Aug. 2017',
					title: 'Junior Designer',
					titleNote: '',
					organization: 'Example Press',
					location: 'Portland, OR',
					spaceAbove: 9,
					body: 'Production design and typesetting for a small independent publisher.'
				}
			]
		},
		{
			id: 'volunteer',
			title: 'Volunteer Experience',
			kind: 'bullets',
			page: 1,
			spaceAbove: 8,
			wrapWhole: true,
			bullets: [
				{
					text: '*Example Public Library* -- design & facilitate maker workshops',
					date: 'Nov. 2023 - Present'
				},
				{ text: '*Example Food Bank* -- sorting & packing', date: 'Jan. 2022 - Present' },
				{ text: '*Example Trail Alliance* -- trail maintenance crew', date: 'Mar. 2019 - 2021' }
			]
		},
		{
			id: 'projects',
			title: 'Personal Projects',
			kind: 'bullets',
			page: 1,
			spaceAbove: 8,
			bullets: [
				{
					text: '*A Small Letterpress Studio*',
					date: 'Jul. 2021 - Present',
					sub: ['Restoring a 1950s platen press and printing short-run broadsides']
				},
				{ text: '*Field Notes* -- a zine about making things by hand', date: 'Jan. 2024 - Present' },
				{
					text: '*Typeface in progress* -- a humanist sans for long-form reading',
					date: 'Jun. 2016 - Present'
				}
			]
		},
		{
			id: 'profdev',
			title: 'Professional Development',
			kind: 'bullets',
			page: 2,
			spaceAbove: 0,
			fontSize: 7.5,
			bullets: [
				{ text: '*Typography & the Grid* -- Example Institute', date: 'Jan. 2024' },
				{ text: '*Accessible Interfaces* -- Example Foundation', date: 'May 2021' },
				{ text: '*Teaching Studio Practice* -- Example College', date: 'Apr. 2021' }
			]
		},
		{
			id: 'certificates',
			title: 'Certificates',
			kind: 'bullets',
			page: 2,
			spaceAbove: 12,
			fontSize: 7.5,
			bullets: [
				{ text: '*First Aid & CPR* -- Example Red Cross', date: 'Jun. 2023 - 2026' },
				{ text: '*Letterpress Safety* -- Example Guild', date: '2019' }
			]
		},
		{
			id: 'exhibitions',
			title: 'Exhibitions & Publications',
			kind: 'exhibitions',
			page: 2,
			spaceAbove: 12,
			entries: [
				{
					title: 'Example Group Show -- "Impressions"',
					meta: 'Example Gallery, Portland OR · Juried',
					date: 'Feb. - Mar. 2025',
					items: [{ text: 'Two broadsides and a bound edition of eight' }]
				},
				{
					title: 'Example Arts Journal',
					meta: 'Example Press · #link("https://example.com")[example.com]',
					items: [
						{ text: 'Vol. 3 "On Making Slowly"', date: 'Jun. 2021' },
						{ text: 'Vol. 2 "Untitled"', date: 'Jun. 2018' }
					]
				}
			]
		}
	]
};
