import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import { config } from './config';
import { getTemplate } from './templates';
import { Semaphore } from './semaphore';

/**
 * A picture of what a template looks like before you've typed anything.
 *
 * Rendered from the template's own `defaultData`, so it always matches what
 * "New resume" will actually produce. There is no user content involved — but
 * the template still renders through `eval(.., mode: "markup")`, so it gets the
 * same throwaway `--root` as any other compile. `DATA_ROOT` stays outside it.
 *
 * Generated lazily on first request and cached under `data/thumbs/`. Deleting
 * that directory is the way to regenerate them after a template changes.
 */

/**
 * A4 is 8.27in wide, so 72 PPI gives typst ~595px to work with — enough that
 * the downscale to `WIDTH` is a real resample rather than an upscale.
 */
const PPI = 72;
const WIDTH = 420;

const renders = new Semaphore(1);
const inflight = new Map<string, Promise<string | null>>();

export function thumbPath(templateId: string): string {
	// `templateId` is validated by `getTemplate` before it reaches here, but this
	// value becomes a filename — keep it from ever being anything but a name.
	return path.join(config.thumbsDir, `${path.basename(templateId)}.png`);
}

/**
 * Return the path to this template's thumbnail, rendering it if it is missing.
 * Returns null when the render fails; the gallery falls back to a placeholder.
 */
export function ensureThumbnail(templateId: string): Promise<string | null> {
	const cached = thumbPath(templateId);
	if (fs.existsSync(cached)) return Promise.resolve(cached);

	// Two visitors hitting an empty gallery must not run typst twice.
	const existing = inflight.get(templateId);
	if (existing) return existing;

	const p = render(templateId).finally(() => inflight.delete(templateId));
	inflight.set(templateId, p);
	return p;
}

async function render(templateId: string): Promise<string | null> {
	const template = getTemplate(templateId);

	await renders.acquire();
	let root: string | null = null;
	try {
		root = fs.mkdtempSync(path.join(os.tmpdir(), `rs-thumb-${path.basename(templateId)}-`));

		fs.copyFileSync(template.entryFile, path.join(root, 'main.typ'));
		if (fs.existsSync(template.assetsDir)) {
			fs.cpSync(template.assetsDir, path.join(root, 'assets'), { recursive: true });
		}
		// The gallery is not signed in as anybody, so there are no uploads to
		// resolve. The templates fall back when `photo`/`logo` are empty.
		fs.mkdirSync(path.join(root, 'images'), { recursive: true });
		const data = {
			...template.defaultData,
			header: { ...template.defaultData.header, photo: '' },
			education: template.defaultData.education.map((e) => ({ ...e, logo: '' }))
		};
		fs.writeFileSync(path.join(root, 'resume.json'), JSON.stringify(data, null, 2));

		const raw = path.join(root, 'thumb.png');
		if (!(await runTypst(root, raw))) return null;

		fs.mkdirSync(config.thumbsDir, { recursive: true });
		const final = thumbPath(templateId);
		const tmp = `${final}.tmp`;
		await sharp(raw)
			.resize({ width: WIDTH, withoutEnlargement: true })
			.png({ compressionLevel: 9 })
			.toFile(tmp);
		fs.renameSync(tmp, final);

		return final;
	} catch (err) {
		console.warn('[thumbs] failed for', templateId, err instanceof Error ? err.message : err);
		return null;
	} finally {
		renders.release();
		if (root) fs.rm(root, { recursive: true, force: true }, () => {});
	}
}

function runTypst(root: string, outPng: string): Promise<boolean> {
	return new Promise((resolve) => {
		const child = spawn(
			config.typstBin,
			[
				'compile',
				'main.typ',
				outPng,
				'--root',
				root,
				'--font-path',
				config.fontPath,
				'--format',
				'png',
				'--ppi',
				String(PPI),
				// Without this, a two-page template makes typst demand a `{n}` in the
				// output filename and fail.
				'--pages',
				'1'
			],
			{
				cwd: root,
				timeout: config.typstTimeoutMs,
				killSignal: 'SIGKILL',
				env: { ...process.env, TYPST_PACKAGE_CACHE_PATH: config.typstPackagePath }
			}
		);

		let log = '';
		const take = (b: Buffer) => {
			if (log.length < 4000) log += b.toString();
		};
		child.stdout.on('data', take);
		child.stderr.on('data', take);

		child.on('error', () => resolve(false));
		child.on('close', (code) => {
			if (code !== 0) console.warn('[thumbs] typst exited', code, log.slice(0, 500));
			resolve(code === 0 && fs.existsSync(outPng));
		});
	});
}
