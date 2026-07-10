import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

// Under Vitest, pin the run to a throwaway DATA_ROOT *here* — before the
// SvelteKit plugin loads, because it snapshots the environment into
// `$env/dynamic/private`. Setting these from a setup file is too late, and the
// suite would quietly open (and migrate) the real ./data database.
if (process.env.VITEST) {
	const root = process.env.RS_TEST_ROOT ?? fs.mkdtempSync(path.join(os.tmpdir(), 'rs-test-'));
	process.env.RS_TEST_ROOT = root;
	process.env.DATA_ROOT = root;
	process.env.DATABASE_PATH = path.join(root, 'test.db');
	process.env.SEED_DIR = path.join(root, 'seed');
	process.env.ORIGIN = 'http://localhost:3000';
	process.env.ALLOWED_EMAILS = 'owner@example.com';
	// Small enough that the daily-cap test doesn't need 100 iterations.
	process.env.CHAT_TURNS_PER_DAY = '3';
	// Likewise: small upload limits keep the fixtures tiny and the assertions sharp.
	process.env.MAX_ASSETS_PER_USER = '3';
	process.env.MAX_IMAGE_DIM = '64';
	process.env.MAX_UPLOAD_BYTES = '65536';
}

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		fs: { allow: ['..'] }
	},
	ssr: {
		// Native bindings — must not be bundled.
		external: ['better-sqlite3', 'sharp']
	},
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}'],
		environment: 'node',
		setupFiles: ['./vitest.setup.ts'],
		// One SQLite file per run, and the suites truncate tables between tests.
		fileParallelism: false
	}
});
