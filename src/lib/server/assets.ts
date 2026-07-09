import fs from 'node:fs';
import path from 'node:path';
import { eq, and } from 'drizzle-orm';
import { db } from './db';
import { assets, type Asset } from './db/schema';
import { config } from './config';

/**
 * Uploaded images live at `${assetsDir}/${userId}/${id}${ext}` and are addressed
 * everywhere else by their opaque `id`.
 *
 * Resume JSON never carries a filesystem path. If it did, a crafted value like
 * `../../data/resume-studio.db` would be handed straight to Typst's `image()`.
 * Instead the id is looked up against the `assets` table (scoped to the owner),
 * and the resolved path is re-checked to be inside that user's directory.
 */

export function userAssetDir(userId: number): string {
	return path.join(config.assetsDir, String(userId));
}

/** Resolve an asset id to an absolute path, or null. Never escapes the user's dir. */
export function resolveAssetPath(userId: number, assetId: string): string | null {
	if (!assetId || !/^[A-Za-z0-9_-]{1,64}$/.test(assetId)) return null;

	const row: Asset | undefined = db
		.select()
		.from(assets)
		.where(and(eq(assets.id, assetId), eq(assets.userId, userId)))
		.get();
	if (!row) return null;

	const base = userAssetDir(userId);
	const full = path.resolve(base, `${row.id}${row.ext}`);

	// Belt and braces: even though `id` is regex-constrained above, confirm the
	// resolved path really sits under the user's directory.
	const rel = path.relative(base, full);
	if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
	if (!fs.existsSync(full)) return null;

	return full;
}
