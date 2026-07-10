<script lang="ts">
	import Icon from '../Icon.svelte';

	interface Props {
		label: string;
		/**
		 * The opaque asset id — never a path or a URL. `resolveAssetPath` is the
		 * only thing that turns one into a filename, and it re-checks containment.
		 */
		value: string | undefined;
		kind?: 'photo' | 'logo';
		hint?: string;
		onchange: () => void;
	}
	let { label, value = $bindable(), kind = 'photo', hint, onchange }: Props = $props();

	let busy = $state(false);
	let error = $state<string | null>(null);
	let input = $state<HTMLInputElement | null>(null);

	async function upload(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;

		busy = true;
		error = null;
		try {
			const body = new FormData();
			body.append('file', file);
			body.append('kind', kind);

			const res = await fetch('/api/assets', { method: 'POST', body });
			const payload = await res.json().catch(() => null);

			if (!res.ok) {
				error = payload?.error ?? payload?.message ?? `Upload failed (${res.status}).`;
				return;
			}

			value = payload.id;
			onchange();
		} catch {
			error = 'Upload failed. Check your connection and try again.';
		} finally {
			busy = false;
			// Let the same file be chosen again after a remove.
			if (input) input.value = '';
		}
	}

	function remove() {
		// Detach it from the résumé, but leave the upload alone: another résumé of
		// theirs may still use it. Unused assets are cleaned up from Settings.
		value = '';
		error = null;
		onchange();
	}
</script>

<div class="block">
	<span class="label">{label}</span>

	<div class="flex items-center gap-3">
		{#if value}
			<!-- The schema constrains an id to [A-Za-z0-9_-], but this value can
			     also arrive from a hand-edited résumé blob. Encode it anyway. -->
			<img
				src="/api/assets/{encodeURIComponent(value)}"
				alt=""
				class="h-14 w-14 shrink-0 rounded-lg border border-line bg-bg-raised object-cover"
			/>
		{:else}
			<div
				class="grid h-14 w-14 shrink-0 place-items-center rounded-lg border border-dashed border-line text-fg-faint"
			>
				<Icon name="file" size={18} />
			</div>
		{/if}

		<div class="min-w-0 flex-1">
			<div class="flex gap-2">
				<button
					type="button"
					class="btn-ghost !px-2 !py-1 text-xs"
					disabled={busy}
					onclick={() => input?.click()}
				>
					{#if busy}
						Uploading…
					{:else}
						{value ? 'Replace' : 'Upload'}
					{/if}
				</button>
				{#if value}
					<button type="button" class="btn-ghost !px-2 !py-1 text-xs" disabled={busy} onclick={remove}>
						<Icon name="x" size={13} /> Remove
					</button>
				{/if}
			</div>
			{#if error}
				<p class="mt-1 text-xs text-red-500">{error}</p>
			{:else if hint}
				<p class="mt-1 text-xs text-fg-faint">{hint}</p>
			{/if}
		</div>
	</div>

	<input
		bind:this={input}
		type="file"
		class="hidden"
		accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/tiff"
		onchange={upload}
	/>
</div>
