import fs from 'node:fs';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOwnedResume } from '$lib/server/access';
import { compileResume, resumePdfPath } from '$lib/server/compile';

export const GET: RequestHandler = async ({ params, locals, url }) => {
	const resume = requireOwnedResume(locals.user, Number(params.id));

	const file = resumePdfPath(resume.id);
	if (!fs.existsSync(file)) {
		// First view, or the PDF was cleaned up — render it now.
		const build = await compileResume(resume.id);
		if (!build.ok || !fs.existsSync(file)) error(409, 'This resume does not currently compile.');
	}

	const body = fs.readFileSync(file);
	const download = url.searchParams.get('download') === '1';
	const filename = `${resume.title.replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '') || 'resume'}.pdf`;

	return new Response(body, {
		headers: {
			'content-type': 'application/pdf',
			'content-length': String(body.byteLength),
			'content-disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
			// It's someone's resume: never let a proxy or the browser cache it.
			'cache-control': 'private, no-store'
		}
	});
};
