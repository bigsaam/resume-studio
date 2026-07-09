import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { config } from '$lib/server/config';
import { safeRedirect } from '$lib/server/access';

const MESSAGES: Record<string, string> = {
	denied: 'Google sign-in was cancelled.',
	state: 'That sign-in link expired. Please try again.',
	oauth: "We couldn't verify your Google account. Please try again."
};

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.user) redirect(303, safeRedirect(url.searchParams.get('redirect')));

	const code = url.searchParams.get('error');
	return {
		configured: config.authConfigured,
		redirectTo: safeRedirect(url.searchParams.get('redirect')),
		error: code ? (MESSAGES[code] ?? 'Sign-in failed. Please try again.') : null
	};
};
