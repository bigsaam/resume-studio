import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { users, usage } from './db/schema';
import { config } from './config';
import { reserveTurn, refundTurn, recordTokens, turnsUsed, utcDay } from './usage';

function makeUser(email: string): number {
	return db.insert(users).values({ email, googleSub: `sub-${email}` }).returning().get().id;
}

beforeEach(() => {
	db.delete(usage).run();
	db.delete(users).run();
});

describe('utcDay', () => {
	it('is UTC, not local', () => {
		// 23:30 on the 1st in UTC — a UTC+2 server must not call this the 2nd.
		expect(utcDay(new Date('2026-03-01T23:30:00Z'))).toBe('2026-03-01');
		expect(utcDay(new Date('2026-03-02T00:30:00Z'))).toBe('2026-03-02');
	});
});

describe('reserveTurn', () => {
	it('allows turns up to the cap, then refuses', () => {
		const uid = makeUser('a@example.com');
		const limit = config.chatTurnsPerDay;
		expect(limit).toBe(3); // set by vitest.setup.ts

		for (let i = 1; i <= limit; i++) {
			const q = reserveTurn(uid);
			expect(q.ok).toBe(true);
			expect(q.used).toBe(i);
		}

		const over = reserveTurn(uid);
		expect(over.ok).toBe(false);
		expect(over.used).toBe(limit);
		expect(turnsUsed(uid)).toBe(limit);
	});

	it('does not increment when it refuses', () => {
		const uid = makeUser('b@example.com');
		for (let i = 0; i < config.chatTurnsPerDay; i++) reserveTurn(uid);

		reserveTurn(uid);
		reserveTurn(uid);

		// A rejected reservation must not creep the counter past the cap, or a
		// later refund would silently hand back a turn that was never granted.
		expect(turnsUsed(uid)).toBe(config.chatTurnsPerDay);
	});

	it('counts each user separately', () => {
		const a = makeUser('c@example.com');
		const b = makeUser('d@example.com');
		reserveTurn(a);
		reserveTurn(a);
		expect(turnsUsed(a)).toBe(2);
		expect(turnsUsed(b)).toBe(0);
		expect(reserveTurn(b).ok).toBe(true);
	});

	it('counts each day separately', () => {
		const uid = makeUser('e@example.com');
		for (let i = 0; i < config.chatTurnsPerDay; i++) reserveTurn(uid, '2026-03-01');
		expect(reserveTurn(uid, '2026-03-01').ok).toBe(false);
		expect(reserveTurn(uid, '2026-03-02').ok).toBe(true);
	});
});

describe('refundTurn', () => {
	it('gives a turn back and never goes negative', () => {
		const uid = makeUser('f@example.com');
		reserveTurn(uid);
		refundTurn(uid);
		expect(turnsUsed(uid)).toBe(0);

		refundTurn(uid);
		expect(turnsUsed(uid)).toBe(0);
	});

	it('frees capacity so the user can chat again', () => {
		const uid = makeUser('g@example.com');
		for (let i = 0; i < config.chatTurnsPerDay; i++) reserveTurn(uid);
		expect(reserveTurn(uid).ok).toBe(false);

		refundTurn(uid);
		expect(reserveTurn(uid).ok).toBe(true);
	});
});

describe('recordTokens', () => {
	it('accumulates and ignores negatives', () => {
		const uid = makeUser('h@example.com');
		reserveTurn(uid);
		recordTokens(uid, 100, 20);
		recordTokens(uid, 50, 5);
		recordTokens(uid, -999, -1);

		const row = db.select().from(usage).where(eq(usage.userId, uid)).get();
		expect(row?.inputTokens).toBe(150);
		expect(row?.outputTokens).toBe(25);
	});
});
