import type { ResumeData } from '../schema';

/** A near-empty resume for someone starting from scratch. Fictional throughout. */
export const starterDefault: ResumeData = {
	theme: {
		colors: { text: '#1f2933', heading: '#1f2933', name: '#111827', sidebar: '#f3f4f6' },
		fonts: { body: 'Inter', secondary: 'Inter', heading: 'Inter' },
		nameSize: 22,
		bodySize: 9,
		photoWidthPct: 80,
		photoBorderColor: '#1f2933',
		photoBorderWidth: 0
	},
	header: {
		firstName: 'Your',
		lastName: 'Name',
		profession: 'Your Title',
		bio: 'A sentence or two about what you do and what you care about.',
		photo: '',
		photoCaption: ''
	},
	contact: [{ icon: 'email', text: 'you@example.com', href: 'mailto:you@example.com' }],
	education: [
		{ logo: '', logoWidth: 30, date: 'Year', lines: ['*Degree*', 'Field of study', 'Institution'] }
	],
	languages: [],
	hobbies: [],
	sections: [
		{
			id: 'work',
			title: 'Experience',
			kind: 'work',
			page: 1,
			spaceAbove: 0,
			entries: [
				{
					timeframe: 'Year - Present',
					title: 'Job Title',
					titleNote: '',
					organization: 'Company',
					location: 'City',
					spaceAbove: 0,
					bullets: ['What you did, and what changed because you did it']
				}
			]
		},
		{
			id: 'skills',
			title: 'Skills',
			kind: 'bullets',
			page: 1,
			spaceAbove: 8,
			bullets: ['A thing you are good at', 'Another thing you are good at']
		}
	]
};
