import { fail } from '@sveltejs/kit';
import { desc } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { invites } from '$lib/server/db/schema';
import { createInvite, requireAdmin } from '$lib/server/access';

export const load: PageServerLoad = ({ locals }) => {
	const user = locals.user!;
	const isAdmin = user.role === 'admin';

	return {
		isAdmin,
		invites: isAdmin
			? db
					.select()
					.from(invites)
					.orderBy(desc(invites.createdAt))
					.all()
					.map((i) => ({
						id: i.id,
						codePrefix: i.codePrefix,
						email: i.email,
						note: i.note,
						uses: i.uses,
						maxUses: i.maxUses,
						revoked: i.revoked,
						expiresAt: i.expiresAt?.getTime() ?? null
					}))
			: []
	};
};

export const actions: Actions = {
	invite: async ({ locals, request }) => {
		// Only admins may mint codes — otherwise one invited guest could onboard
		// the world onto the operator's Anthropic account.
		const admin = requireAdmin(locals.user);

		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim() || null;
		const note = String(form.get('note') ?? '').trim() || null;

		const { code } = createInvite({ createdBy: admin.id, email, note, maxUses: 1, ttlDays: 14 });
		// Shown exactly once — only the hash is stored.
		return { code };
	},

	revoke: async ({ locals, request }) => {
		requireAdmin(locals.user);
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!Number.isInteger(id)) return fail(400, { error: 'bad id' });
		const { eq } = await import('drizzle-orm');
		db.update(invites).set({ revoked: true }).where(eq(invites.id, id)).run();
		return { revoked: true };
	}
};
