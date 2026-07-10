import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createAsset } from '$lib/server/uploads';
import { config } from '$lib/server/config';

/**
 * Upload an image. Returns the opaque asset id, which is the only thing that
 * ever reaches résumé JSON — never a filename, never a path.
 *
 * Assets belong to a user, not a résumé: the same photo is reused across their
 * résumés, and `resolveAssetPath` scopes every read by `userId`.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const user = locals.user;
	if (!user) error(401, 'Not signed in');

	// Reject an oversized body before buffering it, when the client declares it.
	const declared = Number(request.headers.get('content-length') ?? 0);
	if (declared > config.maxUploadBytes * 2) error(413, 'That image is too large.');

	const form = await request.formData().catch(() => null);
	if (!form) error(400, 'Expected a multipart form');

	const file = form.get('file');
	if (!(file instanceof File)) return json({ error: 'No file was uploaded.' }, { status: 400 });

	const kindRaw = form.get('kind');
	const kind = kindRaw === 'logo' ? 'logo' : 'photo';

	if (file.size > config.maxUploadBytes) {
		return json(
			{ error: `That image is too large (max ${Math.floor(config.maxUploadBytes / 1024 / 1024)} MB).` },
			{ status: 413 }
		);
	}

	const buffer = Buffer.from(await file.arrayBuffer());
	const result = await createAsset(user.id, kind, buffer);

	if (!result.ok) return json({ error: result.error }, { status: 400 });
	return json({ id: result.asset.id, bytes: result.asset.bytes }, { status: 201 });
};
