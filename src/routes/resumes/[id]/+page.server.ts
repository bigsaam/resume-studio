import type { PageServerLoad } from './$types';
import { requireOwnedResume } from '$lib/server/access';
import { templates } from '$lib/server/templates';

export const load: PageServerLoad = ({ params, locals }) => {
	const resume = requireOwnedResume(locals.user, Number(params.id));
	return {
		resume: {
			id: resume.id,
			title: resume.title,
			templateId: resume.templateId,
			templateName: templates[resume.templateId]?.name ?? resume.templateId,
			data: resume.data,
			renderVersion: resume.renderVersion
		}
	};
};
