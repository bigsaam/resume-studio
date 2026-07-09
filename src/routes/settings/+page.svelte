<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let copied = $state(false);

	async function copy(code: string) {
		await navigator.clipboard.writeText(code);
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}
</script>

<svelte:head><title>Settings · Resume Studio</title></svelte:head>

<PageHeader title="Settings" subtitle="Appearance is in the sidebar. Invites live here." />

{#if data.isAdmin}
	<div class="card mb-4 p-5">
		<h2 class="mb-1 font-medium">Invite someone</h2>
		<p class="mb-4 text-sm text-fg-muted">
			Codes are single-use and expire in 14 days. The code is shown once — we only store its hash.
		</p>

		{#if form?.code}
			<div class="mb-4 rounded-lg bg-accent-soft p-3">
				<p class="mb-2 text-xs text-fg-muted">Copy this now. You won't see it again.</p>
				<div class="flex items-center gap-2">
					<code class="flex-1 break-all font-mono text-sm">{form.code}</code>
					<button class="btn-ghost !py-1 text-xs" onclick={() => copy(form.code)}>
						<Icon name={copied ? 'check' : 'copy'} size={14} />
						{copied ? 'Copied' : 'Copy'}
					</button>
				</div>
			</div>
		{/if}

		<form method="POST" action="?/invite" use:enhance class="flex flex-wrap items-end gap-2">
			<label class="min-w-[14rem] flex-1">
				<span class="label">Bind to an email (optional)</span>
				<input class="input" name="email" placeholder="friend@example.com" />
			</label>
			<label class="min-w-[10rem] flex-1">
				<span class="label">Note (optional)</span>
				<input class="input" name="note" placeholder="who this is for" />
			</label>
			<button class="btn-accent"><Icon name="plus" size={16} /> Create code</button>
		</form>
	</div>

	<div class="card p-5">
		<h2 class="mb-3 font-medium">Invites</h2>
		{#if data.invites.length === 0}
			<p class="text-sm text-fg-faint">None yet.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead class="text-left text-xs text-fg-faint">
						<tr>
							<th class="py-2 pr-4">Code</th>
							<th class="py-2 pr-4">For</th>
							<th class="py-2 pr-4">Used</th>
							<th class="py-2 pr-4">Status</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{#each data.invites as i (i.id)}
							<tr class="border-t border-line">
								<td class="py-2 pr-4 font-mono text-xs">{i.codePrefix}…</td>
								<td class="py-2 pr-4 text-fg-muted">{i.email ?? i.note ?? 'anyone'}</td>
								<td class="py-2 pr-4 tabular-nums">{i.uses}/{i.maxUses}</td>
								<td class="py-2 pr-4">
									{#if i.revoked}
										<span class="text-red-500">revoked</span>
									{:else if i.uses >= i.maxUses}
										<span class="text-fg-faint">used</span>
									{:else}
										<span class="text-fg-muted">active</span>
									{/if}
								</td>
								<td class="py-2 text-right">
									{#if !i.revoked && i.uses < i.maxUses}
										<form method="POST" action="?/revoke" use:enhance>
											<input type="hidden" name="id" value={i.id} />
											<button class="text-xs text-fg-faint hover:text-red-500">Revoke</button>
										</form>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
{:else}
	<div class="card p-5 text-sm text-fg-muted">
		<p>Nothing to configure yet. Use the sidebar to switch between light and dark.</p>
	</div>
{/if}
