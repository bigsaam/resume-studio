import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOwnedResume } from '$lib/server/access';
import { validateResumeData, writeResumeData, revertToLastGood } from '$lib/server/resumes';
import { compileResume } from '$lib/server/compile';
import { withResumeLock } from '$lib/server/locks';

export const GET: RequestHandler = ({ params, locals }) => {
	const resume = requireOwnedResume(locals.user, Number(params.id));
	return json({ data: resume.data, renderVersion: resume.renderVersion, title: resume.title });
};

/**
 * Save the structured editor's state, then recompile.
 *
 * If the new blob doesn't compile we roll the row back to `last_good_json` and
 * rebuild, so the preview is never left showing a stale PDF for a broken source.
 */
export const PUT: RequestHandler = async ({ params, locals, request }) => {
	const resume = requireOwnedResume(locals.user, Number(params.id));

	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') error(400, 'Expected a JSON body');

	const result = validateResumeData((body as { data?: unknown }).data);
	if (!result.ok) return json({ ok: false, error: result.error }, { status: 400 });

	const outcome = await withResumeLock(resume.id, async () => {
		writeResumeData(resume.id, result.data);

		let build = await compileResume(resume.id);
		let reverted = false;
		// Keep the *original* failure. After a successful revert-rebuild the
		// second log is empty, and that's not the reason the edit was rejected.
		const failureLog = build.ok ? '' : build.log;

		if (!build.ok && revertToLastGood(resume.id)) {
			reverted = true;
			build = await compileResume(resume.id);
		}

		return { ok: build.ok, reverted, version: build.version, log: failureLog };
	});

	// A chat turn is mid-flight on this same resume.
	if (outcome === null) return json({ ok: false, error: 'busy' }, { status: 409 });

	return json(outcome);
};
