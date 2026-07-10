import { asc, eq, sql } from 'drizzle-orm';
import { db } from './db';
import { chatMessages, resumes, type ChatMessage } from './db/schema';

/** Transcript rows are display-only; the model's own memory is its SDK session. */
const HISTORY_LIMIT = 200;

export function listChatMessages(resumeId: number, limit = HISTORY_LIMIT): ChatMessage[] {
	return db
		.select()
		.from(chatMessages)
		.where(eq(chatMessages.resumeId, resumeId))
		.orderBy(asc(chatMessages.createdAt), asc(chatMessages.id))
		.limit(limit)
		.all();
}

export function appendChatMessage(resumeId: number, role: 'user' | 'assistant', text: string): ChatMessage {
	return db.insert(chatMessages).values({ resumeId, role, text }).returning().get();
}

/**
 * Persist the SDK's session id so the next turn resumes with context.
 *
 * Scoped to one resume, never to the process: a single shared session would
 * hand one person's conversation to whoever chats next.
 */
export function setAgentSessionId(resumeId: number, sessionId: string): void {
	db.update(resumes).set({ agentSessionId: sessionId }).where(eq(resumes.id, resumeId)).run();
}

/**
 * Forget the conversation. The transcript goes and so does the SDK session
 * pointer, so the next turn starts cold.
 */
export function clearChat(resumeId: number): void {
	db.transaction((tx) => {
		tx.delete(chatMessages).where(eq(chatMessages.resumeId, resumeId)).run();
		tx.update(resumes).set({ agentSessionId: null }).where(eq(resumes.id, resumeId)).run();
	});
}

export function chatMessageCount(resumeId: number): number {
	return (
		db
			.select({ n: sql<number>`count(*)` })
			.from(chatMessages)
			.where(eq(chatMessages.resumeId, resumeId))
			.get()?.n ?? 0
	);
}
