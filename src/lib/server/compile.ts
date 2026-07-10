import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { eq, sql } from 'drizzle-orm';
import { db } from './db';
import { resumes, type Resume } from './db/schema';
import { config } from './config';
import { getTemplate } from './templates';
import { resolveAssetPath } from './assets';
import { Semaphore } from './semaphore';
import type { ResumeData } from './templates/schema';

/**
 * Renders a resume to PDF with Typst.
 *
 * ## The sandbox
 *
 * Templates render user content through `eval(s, mode: "markup")`, which gives
 * that string the full Typst global scope — including `read()`, `json()` and
 * `image()`. Typst confines all file access to the directory passed as `--root`
 * (a leading `/` is root-relative; `..` past root is a hard error).
 *
 * So each compile gets a **throwaway root** holding only:
 *   main.typ, resume.json, assets/ (generic template icons), images/ (this
 *   user's own uploads).
 *
 * The database, `auth-secret`, `.env`, and every other user's data live outside
 * it and are therefore unreachable. `config.dataRoot` must never be a Typst root.
 *
 * Compute is bounded by a wall-clock timeout; concurrency by a global semaphore.
 */

export interface BuildResult {
	ok: boolean;
	/** Compiler output, redacted. Safe to show the resume's owner. */
	log: string;
	/** Cache-buster for the served PDF. */
	version: number;
}

const MAX_LOG = 8_000;

/* ------------------------------------------------------------- semaphore */

const renders = new Semaphore(config.typstConcurrency);

/* ------------------------------------------------------ per-resume dedupe */

// Coalesces a burst of edits on ONE resume. Keyed by id: a single global
// promise would hand one user's build result to another.
const inflight = new Map<number, Promise<BuildResult>>();

export function compileResume(resumeId: number): Promise<BuildResult> {
	const existing = inflight.get(resumeId);
	if (existing) return existing;
	const p = doCompile(resumeId).finally(() => inflight.delete(resumeId));
	inflight.set(resumeId, p);
	return p;
}

/* ----------------------------------------------------------------- paths */

export function resumeDir(resumeId: number): string {
	return path.join(config.resumesDir, String(resumeId));
}

export function resumePdfPath(resumeId: number): string {
	return path.join(resumeDir(resumeId), 'resume.pdf');
}

/* ----------------------------------------------------------- redact logs */

/**
 * Typst errors quote the offending source line — which is résumé content — and
 * print absolute paths from the temp root. Strip both before this reaches a
 * client or a log file.
 */
function redact(log: string, root: string): string {
	return log
		.split(root)
		.join('<build>')
		.replace(new RegExp(os.tmpdir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '<tmp>')
		.slice(-MAX_LOG);
}

/* ------------------------------------------------- materialize + compile */

/**
 * Rewrite opaque asset ids into root-relative paths, copying each referenced
 * file into `<root>/images/`. Unknown ids become "" so the template's
 * `if photo != ""` fallbacks kick in rather than failing the build.
 */
function materializeAssets(data: ResumeData, userId: number, root: string): ResumeData {
	const imagesDir = path.join(root, 'images');
	fs.mkdirSync(imagesDir, { recursive: true });

	const place = (assetId: string | undefined): string => {
		if (!assetId) return '';
		const src = resolveAssetPath(userId, assetId);
		if (!src) return '';
		const name = `${assetId}${path.extname(src)}`;
		fs.copyFileSync(src, path.join(imagesDir, name));
		return `images/${name}`;
	};

	return {
		...data,
		header: { ...data.header, photo: place(data.header.photo) },
		education: data.education.map((e) => ({ ...e, logo: place(e.logo) }))
	};
}

function runTypst(root: string, outPdf: string): Promise<{ ok: boolean; log: string }> {
	return new Promise((resolve) => {
		const child = spawn(
			config.typstBin,
			[
				'compile',
				'main.typ',
				outPdf,
				// The sandbox. Everything reachable from user content lives under here.
				'--root',
				root,
				'--font-path',
				config.fontPath
			],
			{
				cwd: root,
				timeout: config.typstTimeoutMs,
				killSignal: 'SIGKILL',
				// The one `@preview` package our templates use is vendored here, so a
				// normal render never touches the network. But a `#import "@preview/…"`
				// typed into a résumé field for a package we DON'T have vendored will
				// still be fetched from Typst's registry — the cache path only says
				// where to look and where to save, not "offline" (there is no offline
				// flag in Typst 0.15). That fetch is bounded — registry-only, and the
				// SIGKILL timeout above caps a slow one — but denying this process
				// egress at the container/host is the real fix. See docker-compose.yml.
				env: { ...process.env, TYPST_PACKAGE_CACHE_PATH: config.typstPackagePath }
			}
		);

		let out = '';
		const take = (b: Buffer) => {
			out += b.toString();
			if (out.length > MAX_LOG * 4) out = out.slice(-MAX_LOG * 2);
		};
		child.stdout.on('data', take);
		child.stderr.on('data', take);

		child.on('error', (err) => resolve({ ok: false, log: `Failed to launch typst: ${err.message}` }));
		child.on('close', (code, signal) => {
			if (signal === 'SIGKILL') {
				resolve({ ok: false, log: `Rendering timed out after ${config.typstTimeoutMs / 1000}s.` });
				return;
			}
			resolve({ ok: code === 0, log: out });
		});
	});
}

async function doCompile(resumeId: number): Promise<BuildResult> {
	const resume: Resume | undefined = db.select().from(resumes).where(eq(resumes.id, resumeId)).get();
	if (!resume) return { ok: false, log: 'Resume not found.', version: 0 };

	const template = getTemplate(resume.templateId);

	await renders.acquire();
	let root: string | null = null;
	try {
		root = fs.mkdtempSync(path.join(os.tmpdir(), `rs-${resumeId}-`));

		fs.copyFileSync(template.entryFile, path.join(root, 'main.typ'));
		if (fs.existsSync(template.assetsDir)) {
			fs.cpSync(template.assetsDir, path.join(root, 'assets'), { recursive: true });
		}

		const rendered = materializeAssets(resume.data, resume.userId, root);
		fs.writeFileSync(path.join(root, 'resume.json'), JSON.stringify(rendered, null, 2));

		const outPdf = path.join(root, 'out.pdf');
		const { ok, log } = await runTypst(root, outPdf);
		const safeLog = redact(log, root);

		if (!ok || !fs.existsSync(outPdf)) {
			return { ok: false, log: safeLog, version: resume.renderVersion };
		}

		// Publish atomically so a reader never sees a half-written PDF.
		const dir = resumeDir(resumeId);
		fs.mkdirSync(dir, { recursive: true });
		const finalPdf = resumePdfPath(resumeId);
		const tmpPdf = `${finalPdf}.tmp`;
		fs.copyFileSync(outPdf, tmpPdf);
		fs.renameSync(tmpPdf, finalPdf);

		const updated = db
			.update(resumes)
			.set({
				renderVersion: sql`${resumes.renderVersion} + 1`,
				// This blob compiled, so it becomes the revert target.
				lastGoodJson: resume.data
			})
			.where(eq(resumes.id, resumeId))
			.returning()
			.get();

		return { ok: true, log: safeLog, version: updated.renderVersion };
	} catch (err) {
		return {
			ok: false,
			log: err instanceof Error ? err.message : 'Unknown compile error',
			version: resume.renderVersion
		};
	} finally {
		renders.release();
		if (root) fs.rm(root, { recursive: true, force: true }, () => {});
	}
}
