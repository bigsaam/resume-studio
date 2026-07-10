/**
 * A fixed-capacity sliding-window rate limiter.
 *
 * In memory, like `locks.ts` — which means it bounds one process, not a fleet.
 * Both places that use it (a chat burst, an invite guess) are cheap to
 * over-permit slightly and expensive to get wrong the other way, so this is the
 * right trade for a single-instance deployment. Moving it into SQLite is the
 * change to make before running two of these.
 *
 * Timestamps are passed in rather than read from the clock, so the tests don't
 * have to sleep.
 */

export interface Verdict {
	ok: boolean;
	/** How long until the oldest hit in the window expires. 0 when `ok`. */
	retryAfterMs: number;
}

const ALLOWED: Verdict = { ok: true, retryAfterMs: 0 };

export class RateLimiter {
	#hits = new Map<string, number[]>();

	/**
	 * @param limit   hits allowed per window
	 * @param windowMs length of the window
	 * @param maxKeys  ceiling on tracked keys, so an attacker cycling keys can't
	 *                 grow this map without bound. The oldest key is evicted.
	 */
	constructor(
		private readonly limit: number,
		private readonly windowMs: number,
		private readonly maxKeys = 10_000
	) {}

	/** Record a hit and say whether it is allowed. */
	check(key: string, now: number = Date.now()): Verdict {
		const cutoff = now - this.windowMs;
		const recent = (this.#hits.get(key) ?? []).filter((t) => t > cutoff);

		if (recent.length >= this.limit) {
			// Don't record the rejected hit: a client hammering the endpoint would
			// otherwise keep pushing its own window forward and never recover.
			this.#hits.set(key, recent);
			return { ok: false, retryAfterMs: Math.max(1, recent[0] + this.windowMs - now) };
		}

		recent.push(now);
		this.#hits.set(key, recent);
		this.#evictIfCrowded(cutoff);
		return ALLOWED;
	}

	/** Give a hit back — for work that turned out not to have happened. */
	refund(key: string): void {
		const recent = this.#hits.get(key);
		if (recent?.length) recent.pop();
	}

	#evictIfCrowded(cutoff: number): void {
		if (this.#hits.size <= this.maxKeys) return;

		for (const [key, times] of this.#hits) {
			if (times.length === 0 || times[times.length - 1] <= cutoff) this.#hits.delete(key);
		}
		// Still crowded: drop insertion-order-oldest until we're under the cap.
		while (this.#hits.size > this.maxKeys) {
			const oldest = this.#hits.keys().next();
			if (oldest.done) break;
			this.#hits.delete(oldest.value);
		}
	}

	/** Test seam. */
	get size(): number {
		return this.#hits.size;
	}
}
