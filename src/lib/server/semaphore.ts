/**
 * A counting semaphore, for work that is bounded by the machine rather than by
 * the request: spawning Typst, decoding an image with libvips.
 *
 * Requests queue rather than fail, so a burst is slow instead of fatal. There is
 * no fairness guarantee beyond FIFO, and no timeout — callers that need one
 * bound their own work.
 */
export class Semaphore {
	#active = 0;
	#waiting: Array<() => void> = [];

	constructor(private readonly limit: number) {}

	async acquire(): Promise<void> {
		if (this.#active < this.limit) {
			this.#active++;
			return;
		}
		await new Promise<void>((resolve) => this.#waiting.push(resolve));
		this.#active++;
	}

	release(): void {
		this.#active--;
		this.#waiting.shift()?.();
	}

	/** Run `fn` holding a permit, releasing it however `fn` finishes. */
	async run<T>(fn: () => Promise<T>): Promise<T> {
		await this.acquire();
		try {
			return await fn();
		} finally {
			this.release();
		}
	}
}
