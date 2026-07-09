import fs from 'node:fs';
import { config } from './config';
import { runMigrations } from './db/migrate';

// Runs once per process, before the first request is served.
const g = globalThis as unknown as { __resumeStudioBooted?: boolean };

export function bootstrap(): void {
	if (g.__resumeStudioBooted) return;
	g.__resumeStudioBooted = true;

	fs.mkdirSync(config.dataRoot, { recursive: true });
	fs.mkdirSync(config.resumesDir, { recursive: true });
	fs.mkdirSync(config.assetsDir, { recursive: true });

	runMigrations(config.databasePath);
}
