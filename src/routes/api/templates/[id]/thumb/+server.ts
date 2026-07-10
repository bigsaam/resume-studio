import fs from 'node:fs';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { templates } from '$lib/server/templates';
import { ensureThumbnail } from '$lib/server/thumbnails';

/**
 * A preview of a template's starting content. Rendered on first request and
 * cached on disk; the same picture for everybody, so it holds no user data.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Not signed in');
	// Never hand an unvetted id to the renderer — it becomes a filename.
	if (!templates[params.id]) error(404, 'Not found');

	const file = await ensureThumbnail(params.id);
	if (!file) error(503, 'Preview is not available');

	const body = fs.readFileSync(file);
	return new Response(body, {
		headers: {
			'content-type': 'image/png',
			'content-length': String(body.byteLength),
			// Changes only when the template does, and then the cache file is gone.
			'cache-control': 'private, max-age=3600',
			'x-content-type-options': 'nosniff'
		}
	});
};
