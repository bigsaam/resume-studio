<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Templates · Resume Studio</title></svelte:head>

<PageHeader title="Templates" subtitle="Pick a layout. You can change everything about it afterwards." />

<div class="grid gap-4 sm:grid-cols-2">
	{#each data.templates as t (t.id)}
		<div class="card flex flex-col gap-4 p-5">
			<!-- Rendered from the template's own starting content, so it shows what
			     "Use" will actually produce. `loading="lazy"` matters: the first
			     request for each one runs Typst. -->
			<img
				src="/api/templates/{t.id}/thumb"
				alt="{t.name} template, first page"
				loading="lazy"
				class="aspect-[1/1.414] w-full rounded-lg border border-line bg-white object-cover object-top"
			/>
			<div>
				<h2 class="text-lg font-medium">{t.name}</h2>
				<p class="mt-1 text-sm text-fg-muted">{t.description}</p>
			</div>
			<form method="POST" action="/resumes?/create" class="mt-auto flex items-center gap-2">
				<input type="hidden" name="templateId" value={t.id} />
				<input class="input flex-1" name="title" placeholder="Resume name" value="My {t.name} resume" />
				<button class="btn-accent whitespace-nowrap">
					<Icon name="plus" size={16} /> Use
				</button>
			</form>
		</div>
	{/each}
</div>
