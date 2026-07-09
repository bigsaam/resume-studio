/**
 * Per-resume serialization.
 *
 * A chat turn and a form auto-save both rewrite the same resume row and then
 * recompile. They must not interleave. The old single-tenant app used one global
 * boolean, which also blocked unrelated users — this is keyed by resume id, so
 * different resumes proceed in parallel.
 */
const busy = new Set<number>();

export function isBusy(resumeId: number): boolean {
	return busy.has(resumeId);
}

/** Returns false if the resume is already being written. */
export function tryLock(resumeId: number): boolean {
	if (busy.has(resumeId)) return false;
	busy.add(resumeId);
	return true;
}

export function unlock(resumeId: number): void {
	busy.delete(resumeId);
}

export async function withResumeLock<T>(resumeId: number, fn: () => Promise<T>): Promise<T | null> {
	if (!tryLock(resumeId)) return null;
	try {
		return await fn();
	} finally {
		unlock(resumeId);
	}
}
