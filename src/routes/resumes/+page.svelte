<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
</script>

<svelte:head><title>Resumes · Resume Studio</title></svelte:head>

<PageHeader title="Resumes" subtitle="Every resume you're working on.">
	<a href="/templates" class="btn-accent"><Icon name="plus" size={16} /> New resume</a>
</PageHeader>

{#if data.resumes.length === 0}
	<EmptyState icon="resumes" title="No resumes yet" hint="Pick a template to get started.">
		<a href="/templates" class="btn-accent"><Icon name="plus" size={16} /> New resume</a>
	</EmptyState>
{:else}
	<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
		{#each data.resumes as r (r.id)}
			<div class="card group flex flex-col gap-3 p-4 transition-colors hover:bg-bg-raised">
				<a href="/resumes/{r.id}" class="flex-1">
					<h2 class="font-medium">{r.title}</h2>
					<p class="mt-1 text-xs text-fg-faint">
						{r.templateName} · updated {fmt.format(new Date(r.updatedAt))}
					</p>
				</a>
				<div class="flex items-center gap-2">
					<a href="/resumes/{r.id}" class="btn-ghost flex-1">Open</a>
					<a
						href="/resumes/{r.id}/pdf?v={r.renderVersion}&download=1"
						class="btn-ghost"
						title="Download PDF"
						aria-label="Download PDF"
					>
						<Icon name="download" size={16} />
					</a>
					<form method="POST" action="?/duplicate" use:enhance>
						<input type="hidden" name="id" value={r.id} />
						<button class="btn-ghost text-fg-muted" title="Duplicate" aria-label="Duplicate">
							<Icon name="copy" size={16} />
						</button>
					</form>
					<form
						method="POST"
						action="?/delete"
						use:enhance
						onsubmit={(e) => {
							if (!confirm(`Delete “${r.title}”? This cannot be undone.`)) e.preventDefault();
						}}
					>
						<input type="hidden" name="id" value={r.id} />
						<button class="btn-ghost text-fg-muted hover:text-red-500" title="Delete" aria-label="Delete">
							<Icon name="trash" size={16} />
						</button>
					</form>
				</div>
			</div>
		{/each}
	</div>
{/if}
