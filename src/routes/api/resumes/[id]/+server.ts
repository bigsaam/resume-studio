import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOwnedResume } from '$lib/server/access';
import { setTitle } from '$lib/server/resumes';

/**
 * Rename a résumé from the workbench. The title is metadata, not résumé content,
 * so it doesn't touch `data` and doesn't trigger a recompile — and therefore
 * doesn't need the per-résumé lock either.
 */
export const PATCH: RequestHandler = async ({ params, locals, request }) => {
	const resume = requireOwnedResume(locals.user, Number(params.id));

	const body = await request.json().catch(() => null);
	const raw = (body as { title?: unknown } | null)?.title;
	if (typeof raw !== 'string') return json({ error: 'Expected a title.' }, { status: 400 });

	return json({ ok: true, title: setTitle(resume.id, raw) });
};
