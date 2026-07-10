import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { assets, resumes, users } from './db/schema';
import { config } from './config';
import { starterDefault } from './templates/starter/default';
import {
	assetUsage,
	deleteAsset,
	deleteUnusedAssets,
	referencedAssetIds,
	resolveAssetPath,
	userAssetDir
} from './assets';
import { createAsset } from './uploads';

function makeUser(email: string): number {
	return db.insert(users).values({ email, googleSub: `sub-${email}` }).returning().get().id;
}

/**
 * A JPEG (opaque, so it re-encodes to .jpg) carrying EXIF.
 *
 * `IFD0.Copyright` is a plain string, so it can be grepped for in the output
 * bytes. `IFD3` is libvips' GPS directory; its coordinates are binary
 * rationals with no literal to search for, so the assertion for those is that
 * the whole EXIF block is absent.
 */
function jpegWithExif(size = 32): Promise<Buffer> {
	return sharp({ create: { width: size, height: size, channels: 3, background: '#3366cc' } })
		.jpeg()
		.withExif({
			IFD0: { Copyright: 'EXIF-CANARY' },
			IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1' }
		})
		.toBuffer();
}

/** A PNG with transparency, so it must re-encode to .png. */
function pngWithAlpha(size = 32): Promise<Buffer> {
	return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
		.png()
		.toBuffer();
}

const ok = <T extends { ok: boolean }>(r: T) => {
	if (!r.ok) throw new Error(`expected success, got: ${JSON.stringify(r)}`);
	return r as Extract<T, { ok: true }>;
};

beforeEach(() => {
	db.delete(resumes).run();
	db.delete(assets).run();
	db.delete(users).run();
	fs.rmSync(config.assetsDir, { recursive: true, force: true });
});

describe('createAsset — re-encoding', () => {
	it('strips EXIF, including GPS, from the stored file', async () => {
		const uid = makeUser('a@example.com');
		const input = await jpegWithExif();
		// Guard the fixture itself: an assertion that the canary is gone is
		// worthless if the canary was never there.
		expect(input.includes(Buffer.from('EXIF-CANARY'))).toBe(true);
		expect((await sharp(input).metadata()).exif).toBeDefined();

		const result = ok(await createAsset(uid, 'photo', input));
		const stored = fs.readFileSync(resolveAssetPath(uid, result.asset.id)!);

		expect(stored.includes(Buffer.from('EXIF-CANARY'))).toBe(false);
		// Covers the GPS directory too, whose values are binary.
		expect((await sharp(stored).metadata()).exif).toBeUndefined();
	});

	it('strips ICC and XMP too, not just EXIF', async () => {
		const uid = makeUser('a@example.com');
		const input = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#123456' } })
			.withExif({ IFD0: { Copyright: 'EXIF-CANARY' } })
			.withIccProfile('srgb')
			.withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><XMP-CANARY/></x:xmpmeta>')
			.jpeg()
			.toBuffer();

		const before = await sharp(input).metadata();
		expect(before.icc).toBeDefined();
		expect(before.xmp).toBeDefined();

		const result = ok(await createAsset(uid, 'photo', input));
		const stored = fs.readFileSync(resolveAssetPath(uid, result.asset.id)!);
		const after = await sharp(stored).metadata();

		// sharp drops all metadata unless asked to keep it. Asserted here so an
		// upgrade that flips that default fails loudly instead of leaking.
		expect(after.exif).toBeUndefined();
		expect(after.icc).toBeUndefined();
		expect(after.xmp).toBeUndefined();
		expect(stored.includes(Buffer.from('XMP-CANARY'))).toBe(false);
	});

	it('defuses a polyglot: appended bytes do not survive', async () => {
		const uid = makeUser('a@example.com');
		const payload = Buffer.from('#read("/data/auth-secret") PK\x03\x04 <script>alert(1)</script>');
		const input = Buffer.concat([await jpegWithExif(), payload]);

		const result = ok(await createAsset(uid, 'photo', input));
		const stored = fs.readFileSync(resolveAssetPath(uid, result.asset.id)!);

		expect(stored.includes(payload)).toBe(false);
		expect(stored.includes(Buffer.from('auth-secret'))).toBe(false);
		expect(stored.includes(Buffer.from('<script>'))).toBe(false);
	});

	it('scales an oversized image down to the configured limit', async () => {
		const uid = makeUser('a@example.com');
		const big = await sharp({ create: { width: 500, height: 250, channels: 3, background: '#fff' } })
			.png()
			.toBuffer();

		const result = ok(await createAsset(uid, 'photo', big));
		const meta = await sharp(resolveAssetPath(uid, result.asset.id)!).metadata();

		expect(config.maxImageDim).toBe(64); // set by vite.config.ts under VITEST
		expect(meta.width).toBe(64);
		expect(meta.height).toBe(32); // aspect ratio preserved
	});

	it('does not enlarge a small image', async () => {
		const uid = makeUser('a@example.com');
		const result = ok(await createAsset(uid, 'photo', await jpegWithExif(16)));
		const meta = await sharp(resolveAssetPath(uid, result.asset.id)!).metadata();
		expect(meta.width).toBe(16);
	});

	it('keeps transparency as PNG and stores opaque images as JPEG', async () => {
		const uid = makeUser('a@example.com');

		const transparent = ok(await createAsset(uid, 'logo', await pngWithAlpha()));
		expect(transparent.asset.ext).toBe('.png');

		const opaque = ok(await createAsset(uid, 'photo', await jpegWithExif()));
		expect(opaque.asset.ext).toBe('.jpg');

		// Typst picks its decoder from the extension, so the file must match.
		expect((await sharp(resolveAssetPath(uid, transparent.asset.id)!).metadata()).format).toBe('png');
		expect((await sharp(resolveAssetPath(uid, opaque.asset.id)!).metadata()).format).toBe('jpeg');
	});
});

describe('createAsset — rejections', () => {
	it('refuses an SVG, which is a document rather than an image', async () => {
		const uid = makeUser('a@example.com');
		const svg = Buffer.from(
			'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>'
		);
		const result = await createAsset(uid, 'logo', svg);

		expect(result.ok).toBe(false);
		expect(db.select().from(assets).all()).toHaveLength(0);
	});

	it('refuses bytes that are not an image', async () => {
		const uid = makeUser('a@example.com');
		expect((await createAsset(uid, 'photo', Buffer.from('#!/bin/sh\nrm -rf /\n'))).ok).toBe(false);
	});

	it('refuses a truncated image', async () => {
		const uid = makeUser('a@example.com');
		const truncated = (await jpegWithExif()).subarray(0, 40);
		expect((await createAsset(uid, 'photo', truncated)).ok).toBe(false);
	});

	it('refuses an empty file', async () => {
		const uid = makeUser('a@example.com');
		expect((await createAsset(uid, 'photo', Buffer.alloc(0))).ok).toBe(false);
	});

	it('refuses an upload over the byte ceiling before decoding it', async () => {
		const uid = makeUser('a@example.com');
		const huge = Buffer.alloc(config.maxUploadBytes + 1, 0x41);
		const result = await createAsset(uid, 'photo', huge);

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain('too large');
	});

	it('enforces the per-user asset ceiling', async () => {
		const uid = makeUser('a@example.com');
		for (let i = 0; i < config.maxAssetsPerUser; i++) {
			expect((await createAsset(uid, 'photo', await jpegWithExif())).ok).toBe(true);
		}
		const over = await createAsset(uid, 'photo', await jpegWithExif());
		expect(over.ok).toBe(false);

		// The ceiling is per user, not global.
		const other = makeUser('b@example.com');
		expect((await createAsset(other, 'photo', await jpegWithExif())).ok).toBe(true);
	});

	it('enforces the per-user byte ceiling, not just the count', async () => {
		const uid = makeUser('a@example.com');
		const input = await jpegWithExif();

		const first = ok(await createAsset(uid, 'photo', input));
		// Shrink the ceiling to just under what is already stored plus one more.
		const original = config.maxBytesPerUser;
		try {
			Object.defineProperty(config, 'maxBytesPerUser', { value: first.asset.bytes + 1, configurable: true });
			const over = await createAsset(uid, 'photo', input);
			expect(over.ok).toBe(false);
			if (!over.ok) expect(over.error).toContain('MB');
			// A rejected upload leaves neither a row nor a file.
			expect(db.select().from(assets).all()).toHaveLength(1);
			expect(fs.readdirSync(userAssetDir(uid))).toHaveLength(1);
		} finally {
			Object.defineProperty(config, 'maxBytesPerUser', { value: original, configurable: true });
		}
	});

	it('holds the ceiling against concurrent uploads', async () => {
		const uid = makeUser('a@example.com');
		const input = await jpegWithExif();

		// All of these await sharp before inserting, so they interleave. Without a
		// transactional re-check they would all pass the up-front count.
		const results = await Promise.all(
			Array.from({ length: config.maxAssetsPerUser + 4 }, () => createAsset(uid, 'photo', input))
		);

		expect(results.filter((r) => r.ok)).toHaveLength(config.maxAssetsPerUser);
		expect(db.select().from(assets).all()).toHaveLength(config.maxAssetsPerUser);
		// Every rejected upload cleaned up after itself.
		expect(fs.readdirSync(userAssetDir(uid))).toHaveLength(config.maxAssetsPerUser);
	});

	it('leaves no file behind when it rejects', async () => {
		const uid = makeUser('a@example.com');
		await createAsset(uid, 'photo', Buffer.from('not an image'));
		const dir = userAssetDir(uid);
		expect(fs.existsSync(dir) ? fs.readdirSync(dir) : []).toEqual([]);
	});
});

describe('asset ids', () => {
	/**
	 * `resolveAssetPath` and the résumé schema's `assetId` both gate on this
	 * regex. An id that fails it is written to disk but can never be read back,
	 * and can never be stored in a résumé.
	 */
	it('always satisfy the regex that resolveAssetPath and the schema enforce', async () => {
		const uid = makeUser('a@example.com');
		const input = await jpegWithExif();

		for (let i = 0; i < config.maxAssetsPerUser; i++) {
			const { asset } = ok(await createAsset(uid, 'photo', input));
			expect(asset.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
			// base64url of 16 bytes: no '+', '/' or '=' to confuse a URL or a path.
			expect(asset.id).not.toMatch(/[+/=.]/);
			expect(resolveAssetPath(uid, asset.id)).not.toBeNull();
			db.delete(assets).run(); // stay under the ceiling
		}
	});
});

describe('reaping unused uploads', () => {
	function makeResume(userId: number, photo?: string, logos: string[] = []) {
		const data = structuredClone(starterDefault);
		data.header.photo = photo ?? '';
		data.education = logos.map((logo) => ({ logo, logoWidth: 30, lines: ['*Degree*'] }));
		return db.insert(resumes).values({ userId, templateId: 'starter', title: 'R', data }).returning().get();
	}

	it('finds ids referenced as a photo or an education logo', async () => {
		const uid = makeUser('a@example.com');
		const photo = ok(await createAsset(uid, 'photo', await jpegWithExif())).asset;
		const logo = ok(await createAsset(uid, 'logo', await pngWithAlpha())).asset;
		makeResume(uid, photo.id, [logo.id]);

		expect(referencedAssetIds(uid)).toEqual(new Set([photo.id, logo.id]));
	});

	it('deletes only what no résumé points at', async () => {
		const uid = makeUser('a@example.com');
		const used = ok(await createAsset(uid, 'photo', await jpegWithExif())).asset;
		const orphan = ok(await createAsset(uid, 'photo', await pngWithAlpha())).asset;
		makeResume(uid, used.id);

		expect(deleteUnusedAssets(uid)).toBe(1);
		expect(resolveAssetPath(uid, used.id)).not.toBeNull();
		expect(resolveAssetPath(uid, orphan.id)).toBeNull();
		expect(fs.readdirSync(userAssetDir(uid))).toHaveLength(1);
	});

	it('does not let one user’s résumé keep another user’s upload alive', async () => {
		const owner = makeUser('owner@example.com');
		const other = makeUser('other@example.com');
		const asset = ok(await createAsset(owner, 'photo', await jpegWithExif())).asset;

		// `other` references the id, but it isn't theirs — and it must not save it.
		makeResume(other, asset.id);

		expect(referencedAssetIds(owner)).toEqual(new Set());
		expect(deleteUnusedAssets(owner)).toBe(1);
		expect(resolveAssetPath(owner, asset.id)).toBeNull();
	});

	it('is a no-op when everything is in use', async () => {
		const uid = makeUser('a@example.com');
		const asset = ok(await createAsset(uid, 'photo', await jpegWithExif())).asset;
		makeResume(uid, asset.id);

		expect(deleteUnusedAssets(uid)).toBe(0);
		expect(resolveAssetPath(uid, asset.id)).not.toBeNull();
	});

	it('reports usage totals', async () => {
		const uid = makeUser('a@example.com');
		const a = ok(await createAsset(uid, 'photo', await jpegWithExif())).asset;
		const b = ok(await createAsset(uid, 'logo', await pngWithAlpha())).asset;

		expect(assetUsage(uid)).toEqual({ count: 2, bytes: a.bytes + b.bytes });
		expect(assetUsage(makeUser('empty@example.com'))).toEqual({ count: 0, bytes: 0 });
	});
});

describe('ownership', () => {
	it('will not resolve another user’s asset id', async () => {
		const owner = makeUser('owner@example.com');
		const attacker = makeUser('attacker@example.com');
		const { asset } = ok(await createAsset(owner, 'photo', await jpegWithExif()));

		expect(resolveAssetPath(owner, asset.id)).not.toBeNull();
		expect(resolveAssetPath(attacker, asset.id)).toBeNull();
	});

	it('will not delete another user’s asset', async () => {
		const owner = makeUser('owner@example.com');
		const attacker = makeUser('attacker@example.com');
		const { asset } = ok(await createAsset(owner, 'photo', await jpegWithExif()));

		expect(deleteAsset(attacker, asset.id)).toBe(false);
		expect(resolveAssetPath(owner, asset.id)).not.toBeNull();

		expect(deleteAsset(owner, asset.id)).toBe(true);
		expect(resolveAssetPath(owner, asset.id)).toBeNull();
		expect(db.select().from(assets).where(eq(assets.id, asset.id)).all()).toHaveLength(0);
	});

	it('rejects path traversal dressed up as an asset id', () => {
		const uid = makeUser('owner@example.com');
		for (const evil of ['../../../etc/passwd', '..%2f..%2fetc', '/etc/passwd', '', 'a'.repeat(65)]) {
			expect(resolveAssetPath(uid, evil)).toBeNull();
		}
	});

	it('does not resolve an id whose file is missing', async () => {
		const uid = makeUser('owner@example.com');
		const { asset } = ok(await createAsset(uid, 'photo', await jpegWithExif()));
		fs.rmSync(path.join(userAssetDir(uid), `${asset.id}${asset.ext}`));
		expect(resolveAssetPath(uid, asset.id)).toBeNull();
	});
});
