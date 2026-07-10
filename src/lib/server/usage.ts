import { and, eq, sql } from 'drizzle-orm';
import { db } from './db';
import { usage } from './db/schema';
import { config } from './config';

/**
 * Per-user, per-day agent spend.
 *
 * The operator's Anthropic account pays for every user's chat, so a turn is
 * *reserved before the model is called*, not counted after. Reservation is a
 * single `INSERT .. ON CONFLICT DO UPDATE .. WHERE turns < limit`, so two
 * concurrent turns cannot both read `turns = limit - 1` and both proceed.
 */

/** `YYYY-MM-DD`, UTC — the day boundary must not move with the server's zone. */
export function utcDay(now: Date = new Date()): string {
	return now.toISOString().slice(0, 10);
}

export interface TurnQuota {
	ok: boolean;
	used: number;
	limit: number;
}

/**
 * Claim one turn for today. Returns `ok: false` when the user is at their cap,
 * having changed nothing.
 */
export function reserveTurn(userId: number, day: string = utcDay()): TurnQuota {
	const limit = config.chatTurnsPerDay;

	const claimed = db
		.insert(usage)
		.values({ userId, day, turns: 1 })
		.onConflictDoUpdate({
			target: [usage.userId, usage.day],
			set: { turns: sql`${usage.turns} + 1` },
			where: sql`${usage.turns} < ${limit}`
		})
		.run().changes === 1;

	return { ok: claimed, used: turnsUsed(userId, day), limit };
}

/**
 * Give a reserved turn back. Only for turns that failed before the model was
 * ever reached (bad config, no credentials) — a turn that produced tokens has
 * cost real money and stays counted.
 */
export function refundTurn(userId: number, day: string = utcDay()): void {
	db.update(usage)
		.set({ turns: sql`max(${usage.turns} - 1, 0)` })
		.where(and(eq(usage.userId, userId), eq(usage.day, day)))
		.run();
}

export function recordTokens(userId: number, input: number, output: number, day: string = utcDay()): void {
	db.update(usage)
		.set({
			inputTokens: sql`${usage.inputTokens} + ${Math.max(0, Math.trunc(input))}`,
			outputTokens: sql`${usage.outputTokens} + ${Math.max(0, Math.trunc(output))}`
		})
		.where(and(eq(usage.userId, userId), eq(usage.day, day)))
		.run();
}

export function turnsUsed(userId: number, day: string = utcDay()): number {
	return db
		.select({ turns: usage.turns })
		.from(usage)
		.where(and(eq(usage.userId, userId), eq(usage.day, day)))
		.get()?.turns ?? 0;
}
