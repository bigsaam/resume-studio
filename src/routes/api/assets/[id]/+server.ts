import fs from 'node:fs';
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveAssetPath } from '$lib/server/assets';
import { deleteAsset } from '$lib/server/uploads';

/** Only formats `createAsset` ever writes. */
const CONTENT_TYPE: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg'
};

/**
 * Serve an uploaded image back to its owner, for the editor's preview.
 *
 * `resolveAssetPath` scopes the lookup by `userId` and re-checks that the
 * resolved path is inside that user's directory, so another user's id is a 404
 * rather than a read.
 */
export const GET: RequestHandler = ({ params, locals }) => {
	const user = locals.user;
	if (!user) error(401, 'Not signed in');

	const file = resolveAssetPath(user.id, params.id);
	if (!file) error(404, 'Not found');

	const ext = file.slice(file.lastIndexOf('.'));
	const type = CONTENT_TYPE[ext];
	// A stored file with any other extension means the row and the disk disagree.
	if (!type) error(404, 'Not found');

	const body = fs.readFileSync(file);
	return new Response(body, {
		headers: {
			'content-type': type,
			'content-length': String(body.byteLength),
			// Ids are unguessable and their content never changes, but it is still
			// someone's photograph — keep it out of shared caches.
			'cache-control': 'private, max-age=31536000, immutable',
			// Belt and braces: never let a stored image be interpreted as markup.
			'x-content-type-options': 'nosniff',
			'content-security-policy': "default-src 'none'; sandbox"
		}
	});
};

export const DELETE: RequestHandler = ({ params, locals }) => {
	const user = locals.user;
	if (!user) error(401, 'Not signed in');

	// Someone else's id is indistinguishable from a missing one.
	if (!deleteAsset(user.id, params.id)) error(404, 'Not found');

	// The résumé may still reference this id; `materializeAssets` resolves an
	// unknown id to "" and the templates fall back, so the render stays green.
	return json({ ok: true });
};
