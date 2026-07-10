/**
 * The wire format for a chat turn.
 *
 * One JSON object per line (NDJSON). Events originate in two places — the
 * `query()` message loop and, asynchronously, inside the MCP tool handlers —
 * so both push into a single `EventQueue` that the route drains.
 */

export type AgentEvent =
	/** Human-readable progress, e.g. "Rendering…". Not part of the transcript. */
	| { type: 'status'; text: string }
	/** A chunk of assistant prose. Concatenated by the client. */
	| { type: 'delta'; text: string }
	/** A tool started or finished. */
	| { type: 'tool'; name: string; ok?: boolean }
	/** A compile finished. `version` busts the PDF cache. */
	| { type: 'render'; ok: boolean; version: number; reverted: boolean; log?: string }
	/** Terminal success. `text` is the assistant's final message. */
	| { type: 'done'; text: string; version: number; reverted: boolean }
	/** Terminal failure. */
	| { type: 'error'; message: string };

/**
 * A single-consumer async queue with backpressure-free push.
 *
 * Producers (`push`) never block; the consumer awaits. `close()` ends iteration
 * after any already-queued events drain, so a `done` pushed immediately before
 * closing is still delivered.
 */
export class EventQueue<T> implements AsyncIterable<T> {
	#items: T[] = [];
	#closed = false;
	#wake: (() => void) | null = null;

	push(item: T): void {
		if (this.#closed) return;
		this.#items.push(item);
		this.#wake?.();
		this.#wake = null;
	}

	close(): void {
		this.#closed = true;
		this.#wake?.();
		this.#wake = null;
	}

	async *[Symbol.asyncIterator](): AsyncIterator<T> {
		for (;;) {
			while (this.#items.length > 0) yield this.#items.shift() as T;
			if (this.#closed) return;
			await new Promise<void>((resolve) => {
				this.#wake = resolve;
			});
		}
	}
}
