<script lang="ts">
	interface Props {
		label: string;
		/** Optional schema fields (dates, notes, bodySize) arrive as undefined. */
		value: string | number | undefined;
		type?: 'text' | 'number' | 'color';
		placeholder?: string;
		step?: number;
		onchange: () => void;
	}
	let { label, value = $bindable(), type = 'text', placeholder = '', step, onchange }: Props = $props();
</script>

<label class="block">
	<span class="label">{label}</span>
	{#if type === 'number'}
		<input class="input" type="number" {step} {placeholder} bind:value oninput={onchange} />
	{:else if type === 'color'}
		<div class="flex items-center gap-2">
			<input
				type="color"
				class="h-9 w-10 shrink-0 cursor-pointer rounded border border-line bg-bg-soft"
				value={String(value)}
				oninput={(e) => {
					value = e.currentTarget.value;
					onchange();
				}}
			/>
			<input class="input font-mono" bind:value oninput={onchange} placeholder="#000000" />
		</div>
	{:else}
		<input class="input" type="text" {placeholder} bind:value oninput={onchange} />
	{/if}
</label>
