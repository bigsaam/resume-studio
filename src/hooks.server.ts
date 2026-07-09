import { redirect, type Handle } from '@sveltejs/kit';
import { bootstrap } from '$lib/server/bootstrap';
import { resolveSession, purgeExpiredSessions, SESSION_COOKIE } from '$lib/server/session';

bootstrap();
purgeExpiredSessions();

/** Reachable without a session. Everything else requires one. */
const PUBLIC_PATHS = new Set(['/login', '/logout', '/invite', '/api/health']);

function isPublic(pathname: string): boolean {
	return PUBLIC_PATHS.has(pathname) || pathname.startsWith('/auth/google/');
}

export const handle: Handle = async ({ event, resolve }) => {
	// Identity comes from our own signed session cookie and nothing else. The
	// previous app trusted `x-authentik-*` headers from an upstream proxy; with
	// auth in-process, any such header is attacker-controlled.
	event.locals.user = resolveSession(event.cookies.get(SESSION_COOKIE));

	const { pathname } = event.url;
	if (event.locals.user || isPublic(pathname)) {
		return resolve(event);
	}

	if (pathname.startsWith('/api/')) {
		return new Response(JSON.stringify({ error: 'unauthorized' }), {
			status: 401,
			headers: { 'content-type': 'application/json' }
		});
	}

	const target = pathname + (event.url.search ?? '');
	redirect(303, `/login?redirect=${encodeURIComponent(target)}`);
};
