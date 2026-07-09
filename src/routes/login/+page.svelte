<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let href = $derived(`/auth/google/connect?redirect=${encodeURIComponent(data.redirectTo)}`);
</script>

<svelte:head><title>Sign in · Resume Studio</title></svelte:head>

<div class="grid min-h-screen place-items-center px-4">
	<div class="w-full max-w-sm">
		<div class="mb-8 flex flex-col items-center gap-3 text-center">
			<div class="grid h-12 w-12 place-items-center rounded-xl bg-accent text-white">
				<Icon name="resumes" size={24} />
			</div>
			<div>
				<h1 class="text-2xl font-semibold tracking-tight">Resume Studio</h1>
				<p class="mt-1 text-sm text-fg-muted">Build a resume that looks like you wrote it.</p>
			</div>
		</div>

		{#if data.error}
			<p class="mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500" role="alert">
				{data.error}
			</p>
		{/if}

		{#if data.configured}
			<a {href} data-sveltekit-reload class="btn-primary w-full">Continue with Google</a>
			<p class="mt-4 text-center text-xs text-fg-faint">
				Access is invite-only. <a href="/invite" class="underline hover:text-fg-muted">Have a code?</a>
			</p>
		{:else}
			<div class="card p-4 text-sm text-fg-muted">
				<p class="mb-2 flex items-center gap-2 font-medium text-fg">
					<Icon name="warning" size={16} /> Not configured
				</p>
				<p>
					Set <code class="text-fg">GOOGLE_OAUTH_CLIENT_ID</code> and
					<code class="text-fg">GOOGLE_OAUTH_CLIENT_SECRET</code>, then restart.
				</p>
			</div>
		{/if}
	</div>
</div>
