import { describe, expect, it } from 'vitest';
import { EventQueue } from './events';

async function drain<T>(q: EventQueue<T>): Promise<T[]> {
	const out: T[] = [];
	for await (const item of q) out.push(item);
	return out;
}

describe('EventQueue', () => {
	it('delivers items pushed before iteration starts', async () => {
		const q = new EventQueue<number>();
		q.push(1);
		q.push(2);
		q.close();
		expect(await drain(q)).toEqual([1, 2]);
	});

	it('delivers items queued immediately before close', async () => {
		// The `done` event is pushed and then the queue closes in the same tick.
		// If close() dropped queued items the client would never see it.
		const q = new EventQueue<string>();
		const collected = drain(q);
		q.push('a');
		q.push('done');
		q.close();
		expect(await collected).toEqual(['a', 'done']);
	});

	it('wakes a waiting consumer when an item arrives later', async () => {
		const q = new EventQueue<number>();
		const collected = drain(q);
		await new Promise((r) => setTimeout(r, 5));
		q.push(42);
		await new Promise((r) => setTimeout(r, 5));
		q.close();
		expect(await collected).toEqual([42]);
	});

	it('preserves push order across async gaps', async () => {
		const q = new EventQueue<number>();
		const collected = drain(q);
		for (let i = 0; i < 50; i++) {
			q.push(i);
			if (i % 7 === 0) await Promise.resolve();
		}
		q.close();
		expect(await collected).toEqual([...Array(50).keys()]);
	});

	it('ignores pushes after close', async () => {
		const q = new EventQueue<number>();
		q.push(1);
		q.close();
		q.push(2);
		expect(await drain(q)).toEqual([1]);
	});

	it('terminates on an empty closed queue', async () => {
		const q = new EventQueue<number>();
		q.close();
		expect(await drain(q)).toEqual([]);
	});
});
