import type { User } from '$lib/server/db/schema';

declare global {
	namespace App {
		interface Locals {
			/** The signed-in user, or null. Set by hooks.server.ts from the session cookie. */
			user: User | null;
		}
		interface PageData {
			user?: Pick<User, 'id' | 'email' | 'name' | 'picture' | 'role'> | null;
		}
	}
}

export {};
