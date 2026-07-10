<script lang="ts">
	import Icon from './Icon.svelte';

	interface Props {
		resumeId: number;
		version: number;
		building?: boolean;
		error?: string | null;
	}
	let { resumeId, version, building = false, error = null }: Props = $props();

	// Changing the query string is what makes the iframe refetch.
	let src = $derived(`/resumes/${resumeId}/pdf?v=${version}#toolbar=0&navpanes=0`);
</script>

<div class="relative flex h-full flex-col overflow-hidden rounded-xl border border-line bg-bg-soft">
	<div class="flex h-11 shrink-0 items-center justify-between border-b border-line px-3">
		<span class="text-xs font-medium text-fg-muted">
			{#if building}
				<span class="inline-flex items-center gap-2">
					<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-accent"></span> Rendering…
				</span>
			{:else}
				Preview
			{/if}
		</span>
		<a href="/resumes/{resumeId}/pdf?v={version}&download=1" class="btn-ghost !px-2 !py-1 text-xs">
			<Icon name="download" size={14} /> PDF
		</a>
	</div>

	{#if error}
		<div class="m-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-500">
			<p class="mb-1 flex items-center gap-2 font-medium">
				<Icon name="warning" size={16} /> Couldn't render
			</p>
			<pre class="max-h-40 overflow-auto whitespace-pre-wrap text-xs opacity-90">{error}</pre>
		</div>
	{/if}

	<iframe {src} title="Resume preview" class="min-h-0 flex-1 bg-white" class:opacity-60={building}></iframe>
</div>
