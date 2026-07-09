import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { config } from '$lib/server/config';
import * as schema from './schema';

function createDb() {
	fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
	const sqlite = new Database(config.databasePath);
	sqlite.pragma('journal_mode = WAL');
	sqlite.pragma('busy_timeout = 5000');
	sqlite.pragma('foreign_keys = ON');
	return drizzle(sqlite, { schema });
}

// Vite HMR re-evaluates modules in dev; keep one connection per process.
const g = globalThis as unknown as { __resumeStudioDb?: ReturnType<typeof createDb> };
export const db = g.__resumeStudioDb ?? (g.__resumeStudioDb = createDb());
export { schema };
