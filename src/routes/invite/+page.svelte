<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let code = $state('');

	// The code rides to Google and back in an httpOnly cookie, then gets redeemed
	// in the callback once we know the verified email.
	let href = $derived(`/auth/google/connect?invite=${encodeURIComponent(code.trim())}`);
</script>

<svelte:head><title>Invite · Resume Studio</title></svelte:head>

<div class="grid min-h-screen place-items-center px-4">
	<div class="w-full max-w-sm">
		<div class="mb-8 flex flex-col items-center gap-3 text-center">
			<div class="grid h-12 w-12 place-items-center rounded-xl bg-accent text-white">
				<Icon name="resumes" size={24} />
			</div>
			<h1 class="text-2xl font-semibold tracking-tight">Redeem an invite</h1>
		</div>

		{#if data.denied}
			<p class="mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500" role="alert">
				That Google account isn't on the guest list. If someone gave you an invite code, enter it below.
			</p>
		{/if}

		<label class="label" for="code">Invite code</label>
		<input
			id="code"
			class="input font-mono"
			bind:value={code}
			placeholder="paste your code"
			autocomplete="off"
			spellcheck="false"
		/>

		<a
			href={code.trim() ? href : '#'}
			data-sveltekit-reload
			aria-disabled={!code.trim()}
			class="btn-primary mt-4 w-full {code.trim() ? '' : 'pointer-events-none opacity-50'}"
		>
			Continue with Google
		</a>

		<p class="mt-4 text-center text-xs text-fg-faint">
			<a href="/login" class="underline hover:text-fg-muted">Back to sign in</a>
		</p>
	</div>
</div>
