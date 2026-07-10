/**
 * The throwaway DATA_ROOT is chosen in `vite.config.ts` — it has to be set
 * before the SvelteKit plugin snapshots the environment. All this file does is
 * make sure the schema exists before the first test opens the connection.
 */
import { runMigrations } from './src/lib/server/db/migrate';
import { config } from './src/lib/server/config';

runMigrations(config.databasePath);
