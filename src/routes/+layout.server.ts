import type { LayoutServerLoad } from './$types';
import { listResumes } from '$lib/server/resumes';

export const load: LayoutServerLoad = ({ locals }) => {
	const user = locals.user;
	if (!user) return { user: null, resumeCount: 0 };

	return {
		// Only what the chrome needs — never leak the whole row to the client.
		user: {
			id: user.id,
			email: user.email,
			name: user.name,
			picture: user.picture,
			role: user.role
		},
		resumeCount: listResumes(user.id).length
	};
};
