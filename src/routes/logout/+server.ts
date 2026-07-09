import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { destroySession, SESSION_COOKIE } from '$lib/server/session';

const handler: RequestHandler = ({ cookies }) => {
	destroySession(cookies.get(SESSION_COOKIE));
	cookies.delete(SESSION_COOKIE, { path: '/' });
	redirect(303, '/login');
};

export const GET = handler;
export const POST = handler;
