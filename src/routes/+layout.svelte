<script lang="ts">
	import '../app.css';
	import { page } from '$app/stores';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import type { LayoutData } from './$types';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

	// Login and the invite gate render without the app chrome.
	let bare = $derived($page.url.pathname === '/login' || $page.url.pathname === '/invite');
</script>

{#if bare}
	{@render children()}
{:else}
	<div class="flex h-screen overflow-hidden">
		<Sidebar user={data.user} resumeCount={data.resumeCount} />
		<main class="flex-1 overflow-y-auto px-6 py-6">
			{@render children()}
		</main>
	</div>
{/if}
