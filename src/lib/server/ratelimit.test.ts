import { describe, expect, it } from 'vitest';
import { RateLimiter } from './ratelimit';

describe('RateLimiter', () => {
	it('allows up to the limit inside the window, then refuses', () => {
		const rl = new RateLimiter(3, 60_000);
		expect(rl.check('a', 1000).ok).toBe(true);
		expect(rl.check('a', 1001).ok).toBe(true);
		expect(rl.check('a', 1002).ok).toBe(true);
		expect(rl.check('a', 1003).ok).toBe(false);
	});

	it('reports how long to wait, measured from the oldest hit', () => {
		const rl = new RateLimiter(1, 10_000);
		rl.check('a', 1_000);
		const verdict = rl.check('a', 3_000);
		expect(verdict.ok).toBe(false);
		// The first hit leaves the window at 11_000, i.e. 8s from now.
		expect(verdict.retryAfterMs).toBe(8_000);
	});

	it('does not let a hammering client push its own window forward', () => {
		const rl = new RateLimiter(1, 1_000);
		expect(rl.check('a', 0).ok).toBe(true);

		// Rejected hits must not be recorded, or the window never drains.
		for (let t = 100; t < 1_000; t += 100) expect(rl.check('a', t).ok).toBe(false);

		// The single recorded hit at t=0 has now aged out.
		expect(rl.check('a', 1_001).ok).toBe(true);
	});

	it('drains as the window slides', () => {
		const rl = new RateLimiter(2, 1_000);
		expect(rl.check('a', 0).ok).toBe(true);
		expect(rl.check('a', 500).ok).toBe(true);
		expect(rl.check('a', 600).ok).toBe(false);

		expect(rl.check('a', 1_001).ok).toBe(true); // the t=0 hit expired
		expect(rl.check('a', 1_002).ok).toBe(false); // t=500 still counts
		expect(rl.check('a', 1_501).ok).toBe(true); // and now it doesn't
	});

	it('keys are independent', () => {
		const rl = new RateLimiter(1, 1_000);
		expect(rl.check('a', 0).ok).toBe(true);
		expect(rl.check('a', 1).ok).toBe(false);
		expect(rl.check('b', 1).ok).toBe(true);
	});

	it('refunds a hit', () => {
		const rl = new RateLimiter(1, 10_000);
		expect(rl.check('a', 0).ok).toBe(true);
		expect(rl.check('a', 1).ok).toBe(false);

		rl.refund('a');
		expect(rl.check('a', 2).ok).toBe(true);
	});

	it('does not grow without bound when keys are cycled', () => {
		const rl = new RateLimiter(1, 1_000, 50);
		// An attacker rotating source addresses must not grow the map forever.
		for (let i = 0; i < 5_000; i++) rl.check(`key-${i}`, 10_000 + i);
		expect(rl.size).toBeLessThanOrEqual(50);
	});

	it('still limits a real key after an eviction sweep', () => {
		const rl = new RateLimiter(1, 100_000, 10);
		expect(rl.check('victim', 1).ok).toBe(true);
		for (let i = 0; i < 100; i++) rl.check(`noise-${i}`, 2 + i);

		// `victim` may have been evicted — that's the accepted cost of a bounded
		// map — but the limiter must still work for whoever is tracked now.
		expect(rl.check('fresh', 1_000).ok).toBe(true);
		expect(rl.check('fresh', 1_001).ok).toBe(false);
	});
});
