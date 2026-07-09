import { redirect, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { listResumes, createResume, deleteResume } from '$lib/server/resumes';
import { requireOwnedResume } from '$lib/server/access';
import { compileResume } from '$lib/server/compile';
import { templates } from '$lib/server/templates';

export const load: PageServerLoad = ({ locals }) => {
	const user = locals.user!;
	return {
		resumes: listResumes(user.id).map((r) => ({
			id: r.id,
			title: r.title,
			templateId: r.templateId,
			templateName: templates[r.templateId]?.name ?? r.templateId,
			updatedAt: r.updatedAt.getTime(),
			renderVersion: r.renderVersion
		}))
	};
};

export const actions: Actions = {
	create: async ({ locals, request }) => {
		const form = await request.formData();
		const templateId = String(form.get('templateId') ?? 'typographic');
		if (!templates[templateId]) return fail(400, { error: 'Unknown template' });

		const resume = createResume({ userId: locals.user!.id, templateId, title: String(form.get('title') ?? '') });
		await compileResume(resume.id);
		redirect(303, `/resumes/${resume.id}`);
	},

	delete: async ({ locals, request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		// Throws 404 if it isn't theirs.
		requireOwnedResume(locals.user, id);
		deleteResume(id);
		return { deleted: true };
	}
};
