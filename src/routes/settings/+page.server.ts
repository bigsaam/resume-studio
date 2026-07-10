import { fail } from '@sveltejs/kit';
import { desc } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { invites } from '$lib/server/db/schema';
import { createInvite, requireAdmin } from '$lib/server/access';
import {
	assetUsage,
	deleteAsset,
	deleteUnusedAssets,
	listAssets,
	referencedAssetIds
} from '$lib/server/assets';
import { config } from '$lib/server/config';

export const load: PageServerLoad = ({ locals }) => {
	const user = locals.user!;
	const isAdmin = user.role === 'admin';

	// An upload no résumé points at is dead weight; nothing else reaps it.
	const referenced = referencedAssetIds(user.id);
	const usage = assetUsage(user.id);

	return {
		isAdmin,
		uploads: {
			assets: listAssets(user.id).map((a) => ({
				id: a.id,
				kind: a.kind,
				bytes: a.bytes,
				createdAt: a.createdAt.getTime(),
				used: referenced.has(a.id)
			})),
			count: usage.count,
			bytes: usage.bytes,
			maxCount: config.maxAssetsPerUser,
			maxBytes: config.maxBytesPerUser
		},
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
	/** Delete one upload. Scoped by owner, so someone else's id is a no-op 404. */
	deleteUpload: async ({ locals, request }) => {
		const user = locals.user!;
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!deleteAsset(user.id, id)) return fail(404, { error: 'Not found' });
		return { deletedUpload: true };
	},

	/**
	 * Delete every upload no résumé references. Removing a photo from a résumé
	 * only detaches the id — the file stays, because another résumé may still use
	 * it. This is the only thing that collects them.
	 */
	purgeUploads: async ({ locals }) => {
		const removed = deleteUnusedAssets(locals.user!.id);
		return { purged: removed };
	},

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
