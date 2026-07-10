import type { PageServerLoad } from './$types';
import { requireOwnedResume } from '$lib/server/access';
import { templates } from '$lib/server/templates';
import { listChatMessages } from '$lib/server/chat';
import { config } from '$lib/server/config';

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
		},
		chat: {
			// The agent's own memory is its SDK session; this is just the transcript.
			history: listChatMessages(resume.id).map((m) => ({ role: m.role, text: m.text })),
			enabled: config.agentConfigured
		}
	};
};
