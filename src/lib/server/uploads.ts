import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { and, eq, sql } from 'drizzle-orm';
import { db } from './db';
import { assets, type Asset } from './db/schema';
import { config } from './config';
import { userAssetDir } from './assets';
import { Semaphore } from './semaphore';

/**
 * Image ingest.
 *
 * Nothing a user uploads is ever stored as they sent it. Every upload is fully
 * decoded to raw pixels and **re-encoded** from those pixels, which is what
 * makes this safe rather than merely validated:
 *
 * - EXIF (including GPS coordinates and the camera's serial number) is not
 *   copied to the output. sharp drops metadata unless asked to keep it, and we
 *   never ask. Orientation is applied to the pixels first, so nothing is lost.
 * - A polyglot — a valid JPEG with a ZIP, a shell script, or Typst markup
 *   appended — cannot survive, because the trailing bytes are not pixels and
 *   the output is written from the decode buffer alone.
 * - Decompression bombs are refused before they allocate: `limitInputPixels`.
 * - SVG is rejected outright. libvips would render it, and an SVG is a document
 *   with external-entity and script surface, not an image.
 *
 * This module deliberately does not live in `assets.ts`: that file is on the
 * Typst compile path (`resolveAssetPath`), and there is no reason to pull
 * libvips into a render.
 */

/** Formats we will decode. Notably absent: `svg`. */
const DECODABLE = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'tiff']);

export type UploadOutcome = { ok: true; asset: Asset } | { ok: false; error: string };

const fail = (error: string): UploadOutcome => ({ ok: false, error });

/** Opaque, unguessable, and already matching the `assetId` schema regex. */
function newAssetId(): string {
	return crypto.randomBytes(16).toString('base64url');
}

/**
 * Bounds concurrent decodes, not requests. A single decode can hold
 * `maxImagePixels` × 4 bytes of raw pixels; nothing else stops a burst of
 * uploads from holding all of them at once. Renders are bounded the same way
 * (`compile.ts`).
 */
const decodes = new Semaphore(config.uploadConcurrency);

export function assetCount(userId: number): number {
	return usageFor(userId).count;
}

function usageFor(userId: number): { count: number; bytes: number } {
	const row = db
		.select({ n: sql<number>`count(*)`, b: sql<number>`coalesce(sum(${assets.bytes}), 0)` })
		.from(assets)
		.where(eq(assets.userId, userId))
		.get();
	return { count: row?.n ?? 0, bytes: row?.b ?? 0 };
}

export async function createAsset(
	userId: number,
	kind: 'photo' | 'logo',
	input: Buffer
): Promise<UploadOutcome> {
	if (input.length === 0) return fail('That file is empty.');
	if (input.length > config.maxUploadBytes) {
		return fail(`That image is too large (max ${Math.floor(config.maxUploadBytes / 1024 / 1024)} MB).`);
	}
	// Fast path only. The authoritative check happens inside the insert
	// transaction below, because `sharp` is awaited in between.
	if (assetCount(userId) >= config.maxAssetsPerUser) {
		return fail(`You've reached the limit of ${config.maxAssetsPerUser} uploaded images. Delete one first.`);
	}

	const open = () =>
		sharp(input, {
			limitInputPixels: config.maxImagePixels,
			// Read only the first frame of an animated GIF/WebP.
			animated: false,
			failOn: 'error'
		});

	// Everything that touches libvips runs under the decode permit.
	const decoded = await decodes.run(async (): Promise<{ ext: string; output: Buffer } | UploadOutcome> => {
		let format: string | undefined;
		let hasAlpha = false;
		try {
			const meta = await open().metadata();
			format = meta.format;
			hasAlpha = meta.hasAlpha === true;
		} catch {
			// Unreadable, truncated, or over the pixel ceiling. Don't echo libvips'
			// message back — it quotes file paths and internal loader names.
			return fail("That doesn't look like an image we can read.");
		}

		// The check is on the format libvips *decoded*, never on the filename or
		// the client's Content-Type. `svg` is absent from DECODABLE, so an SVG is
		// refused here and never reaches the pipeline below that would rasterize
		// it — which is the step that could fetch a referenced resource.
		if (!format || !DECODABLE.has(format)) {
			return fail('Use a JPEG, PNG, WebP, GIF, AVIF or TIFF image.');
		}

		// Keep transparency when there is any; otherwise JPEG is far smaller. Both
		// are formats Typst's `image()` reads, and the extension is what tells it so.
		const ext = hasAlpha ? '.png' : '.jpg';

		try {
			const pipeline = open()
				// Bake EXIF orientation into the pixels *before* the resize, since the
				// tag itself will not be carried over.
				.rotate()
				.resize({
					width: config.maxImageDim,
					height: config.maxImageDim,
					fit: 'inside',
					withoutEnlargement: true
				});

			const output = hasAlpha
				? await pipeline.png({ compressionLevel: 9 }).toBuffer()
				: await pipeline.jpeg({ quality: 82 }).toBuffer();
			return { ext, output };
		} catch {
			return fail('That image could not be processed.');
		}
	});

	if ('ok' in decoded) return decoded;
	const { ext, output } = decoded;

	const id = newAssetId();
	const dir = userAssetDir(userId);
	fs.mkdirSync(dir, { recursive: true });

	// Publish atomically: a half-written file must never be reachable by a
	// compile that is already running.
	const final = path.join(dir, `${id}${ext}`);
	const tmp = `${final}.tmp`;
	fs.writeFileSync(tmp, output, { mode: 0o600 });
	fs.renameSync(tmp, final);

	try {
		// Re-check both ceilings and insert in one synchronous transaction. The
		// earlier check is only a fast path: `sharp` is awaited between the two,
		// so N concurrent uploads would otherwise all pass a check-then-act test
		// and land N rows over the cap. better-sqlite3 is synchronous, so nothing
		// interleaves inside this callback.
		const asset = db.transaction((tx) => {
			const row = tx
				.select({ n: sql<number>`count(*)`, b: sql<number>`coalesce(sum(${assets.bytes}), 0)` })
				.from(assets)
				.where(eq(assets.userId, userId))
				.get();

			if ((row?.n ?? 0) >= config.maxAssetsPerUser) throw new CeilingReached('count');
			if ((row?.b ?? 0) + output.length > config.maxBytesPerUser) throw new CeilingReached('bytes');

			return tx.insert(assets).values({ id, userId, kind, ext, bytes: output.length }).returning().get();
		});
		return { ok: true, asset };
	} catch (err) {
		// No row means `resolveAssetPath` can never find it — don't leave the file.
		fs.rmSync(final, { force: true });
		if (err instanceof CeilingReached) {
			return fail(
				err.which === 'count'
					? `You've reached the limit of ${config.maxAssetsPerUser} uploaded images. Delete one first.`
					: `Your uploads would exceed ${Math.floor(config.maxBytesPerUser / 1024 / 1024)} MB. Delete an image first.`
			);
		}
		throw err;
	}
}

class CeilingReached extends Error {
	constructor(readonly which: 'count' | 'bytes') {
		super(`asset ceiling reached: ${which}`);
	}
}

/**
 * Delete an asset the caller owns. Returns false for an id they don't own, so
 * the route can 404 rather than confirm the id exists.
 */
export function deleteAsset(userId: number, assetId: string): boolean {
	const row = db
		.select()
		.from(assets)
		.where(and(eq(assets.id, assetId), eq(assets.userId, userId)))
		.get();
	if (!row) return false;

	db.delete(assets).where(and(eq(assets.id, assetId), eq(assets.userId, userId))).run();
	// The row is the source of truth; a leftover file is unreachable without it.
	fs.rmSync(path.join(userAssetDir(userId), `${row.id}${row.ext}`), { force: true });
	return true;
}
