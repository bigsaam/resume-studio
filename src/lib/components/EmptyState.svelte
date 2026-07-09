<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	interface Props {
		icon?: string;
		title: string;
		hint?: string;
		children?: Snippet;
	}
	let { icon = 'resumes', title, hint, children }: Props = $props();
</script>

<div class="grid place-items-center rounded-xl border border-dashed border-line py-20 text-center">
	<div class="mb-3 grid h-12 w-12 place-items-center rounded-full bg-bg-raised text-fg-faint">
		<Icon name={icon} size={22} />
	</div>
	<p class="text-fg-muted">{title}</p>
	{#if hint}
		<p class="mt-1 text-sm text-fg-faint">{hint}</p>
	{/if}
	{#if children}
		<div class="mt-5">{@render children()}</div>
	{/if}
</div>
