/**
 * Render every template from its own starting content, offline.
 *
 * Catches the two things that break quietly: a `main.typ` that stopped
 * compiling, and a font or `@preview` package that stopped resolving from the
 * vendored cache. Run in CI, where there is no network and no real cache.
 *
 *   node --experimental-strip-types scripts/render-templates.ts
 *
 * Deliberately does not import `lib/server/compile.ts`: that module pulls in
 * `$env/dynamic/private` and the database, neither of which exists here.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { typographicDefault } from '../src/lib/server/templates/typographic/default.ts';
import { starterDefault } from '../src/lib/server/templates/starter/default.ts';
import type { ResumeData } from '../src/lib/server/templates/schema.ts';

const TEMPLATES: Array<[string, ResumeData]> = [
	['typographic', typographicDefault],
	['starter', starterDefault]
];

const repoRoot = path.resolve(import.meta.dirname, '..');
const typstBin = process.env.TYPST_BIN ?? 'typst';

let failed = 0;

for (const [id, data] of TEMPLATES) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), `rs-render-${id}-`));
	try {
		const dir = path.join(repoRoot, 'src/lib/server/templates', id);
		fs.copyFileSync(path.join(dir, 'main.typ'), path.join(root, 'main.typ'));
		if (fs.existsSync(path.join(dir, 'assets'))) {
			fs.cpSync(path.join(dir, 'assets'), path.join(root, 'assets'), { recursive: true });
		}
		// No uploads: the templates must render cleanly with no photo and no logos.
		fs.mkdirSync(path.join(root, 'images'), { recursive: true });
		const rendered = {
			...data,
			header: { ...data.header, photo: '' },
			education: data.education.map((e) => ({ ...e, logo: '' }))
		};
		fs.writeFileSync(path.join(root, 'resume.json'), JSON.stringify(rendered, null, 2));

		const out = path.join(root, 'out.pdf');
		execFileSync(
			typstBin,
			['compile', 'main.typ', out, '--root', root, '--font-path', path.join(repoRoot, 'fonts')],
			{
				cwd: root,
				stdio: 'pipe',
				env: {
					...process.env,
					// Resolve `@preview/...` from the vendored cache, never the network.
					TYPST_PACKAGE_CACHE_PATH: path.join(repoRoot, 'vendor/typst-packages')
				}
			}
		);

		const bytes = fs.statSync(out).size;
		if (bytes < 1000) throw new Error(`suspiciously small PDF: ${bytes} bytes`);
		console.log(`✓ ${id.padEnd(14)} ${bytes} bytes`);
	} catch (err) {
		failed++;
		const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? '';
		console.error(`✗ ${id}\n${stderr || (err as Error).message}`);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
}

if (failed > 0) {
	console.error(`\n${failed} template(s) failed to render.`);
	process.exit(1);
}
console.log(`\nAll ${TEMPLATES.length} templates render offline.`);
