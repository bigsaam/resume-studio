import fs from 'node:fs';
import path from 'node:path';
import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from './db';
import { assets, resumes, type Asset } from './db/schema';
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

/* ------------------------------------------------------------ bookkeeping */

export function listAssets(userId: number): Asset[] {
	return db.select().from(assets).where(eq(assets.userId, userId)).orderBy(desc(assets.createdAt)).all();
}

/** How much of their upload allowance a user has spent. */
export function assetUsage(userId: number): { count: number; bytes: number } {
	const row = db
		.select({ n: sql<number>`count(*)`, b: sql<number>`coalesce(sum(${assets.bytes}), 0)` })
		.from(assets)
		.where(eq(assets.userId, userId))
		.get();
	return { count: row?.n ?? 0, bytes: row?.b ?? 0 };
}

/**
 * Every asset id this user's résumés still point at.
 *
 * `header.photo` and `education[].logo` are the only two places the schema lets
 * an id appear, so this is exhaustive by construction — but it reads the stored
 * blobs rather than trusting that, because an id that stops being referenced
 * here is one we are about to offer to delete.
 */
export function referencedAssetIds(userId: number): Set<string> {
	const referenced = new Set<string>();

	for (const row of db.select({ data: resumes.data }).from(resumes).where(eq(resumes.userId, userId)).all()) {
		const photo = row.data?.header?.photo;
		if (photo) referenced.add(photo);
		for (const edu of row.data?.education ?? []) {
			if (edu.logo) referenced.add(edu.logo);
		}
	}
	return referenced;
}

/** Drop the row and the file. Returns false for an id the user doesn't own. */
export function deleteAsset(userId: number, assetId: string): boolean {
	const row = db
		.select()
		.from(assets)
		.where(and(eq(assets.id, assetId), eq(assets.userId, userId)))
		.get();
	if (!row) return false;

	db.delete(assets)
		.where(and(eq(assets.id, assetId), eq(assets.userId, userId)))
		.run();
	// The row is the source of truth; a leftover file is unreachable without it.
	fs.rmSync(path.join(userAssetDir(userId), `${row.id}${row.ext}`), { force: true });
	return true;
}

/** Delete every upload no résumé references. Returns how many went. */
export function deleteUnusedAssets(userId: number): number {
	const referenced = referencedAssetIds(userId);
	let removed = 0;
	for (const asset of listAssets(userId)) {
		if (referenced.has(asset.id)) continue;
		if (deleteAsset(userId, asset.id)) removed++;
	}
	return removed;
}
