// Idempotent migration runner. Called once at boot from bootstrap.ts, and also
// usable standalone via `pnpm db:migrate`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

function resolveMigrationsFolder(): string {
	const here = path.dirname(fileURLToPath(import.meta.url));
	const candidates = [
		path.resolve('drizzle'),
		path.resolve(process.cwd(), 'drizzle'),
		// When bundled into build/, drizzle/ sits next to it.
		path.resolve(here, '../../../../drizzle')
	];
	for (const c of candidates) {
		if (fs.existsSync(path.join(c, 'meta', '_journal.json'))) return c;
	}
	throw new Error(`Could not locate the drizzle/ migrations folder. Tried:\n  ${candidates.join('\n  ')}`);
}

export function runMigrations(databasePath: string): void {
	fs.mkdirSync(path.dirname(databasePath), { recursive: true });
	const sqlite = new Database(databasePath);
	sqlite.pragma('journal_mode = WAL');
	try {
		migrate(drizzle(sqlite), { migrationsFolder: resolveMigrationsFolder() });
	} finally {
		sqlite.close();
	}
}

// Standalone CLI: `node --experimental-strip-types src/lib/server/db/migrate.ts`
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
	const dbPath = process.env.DATABASE_PATH ?? path.resolve('data/resume-studio.db');
	runMigrations(dbPath);
	console.log(`migrations applied → ${dbPath}`);
}
