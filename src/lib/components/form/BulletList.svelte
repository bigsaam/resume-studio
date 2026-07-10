<script lang="ts">
	import ListEditor from './ListEditor.svelte';
	import Icon from '../Icon.svelte';
	import {
		bulletDate,
		bulletSub,
		bulletText,
		hasSub,
		withDate,
		withSub,
		withSubLines,
		withText,
		withoutSub
	} from '$lib/sections';
	import type { Bullet } from '$lib/server/templates/schema';

	interface Props {
		bullets: Bullet[];
		onchange: () => void;
	}
	let { bullets = $bindable(), onchange }: Props = $props();

	// A bullet is `string | {text, date?, sub?}`. Editing a mixed list is
	// confusing, so once any bullet carries a date we show the date column for
	// all of them.
	let dated = $derived(bullets.some((b) => typeof b === 'object' && b.date !== undefined));

	function edit(i: number, next: Bullet) {
		bullets[i] = next;
		onchange();
	}
</script>

<ListEditor
	bind:items={bullets}
	makeNew={() => (dated ? { text: '', date: '' } : '')}
	addLabel="Add bullet"
	{onchange}
>
	{#snippet row(_b, i)}
		<div class="flex flex-col gap-2">
			<div class="flex gap-2">
				<textarea
					class="input min-h-[2.5rem] flex-1 resize-y"
					rows="2"
					value={bulletText(bullets[i])}
					oninput={(e) => edit(i, withText(bullets[i], e.currentTarget.value))}
					placeholder="Bullet text — *bold* and -- en dash work"></textarea>
				{#if dated}
					<input
						class="input w-40 shrink-0 self-start"
						value={bulletDate(bullets[i])}
						oninput={(e) => edit(i, withDate(bullets[i], e.currentTarget.value))}
						placeholder="Jan. 2024"
					/>
				{/if}
			</div>

			{#if hasSub(bullets[i])}
				<div class="flex items-start gap-2">
					<textarea
						class="input resize-y text-xs"
						rows="2"
						value={bulletSub(bullets[i]).join('\n')}
						oninput={(e) => edit(i, withSubLines(bullets[i], e.currentTarget.value))}
						placeholder="Sub-bullets, one per line (max 10)"></textarea>
					<button
						type="button"
						class="shrink-0 rounded p-1 text-fg-faint hover:text-red-500"
						onclick={() => edit(i, withoutSub(bullets[i]))}
						aria-label="Remove sub-bullets"><Icon name="x" size={13} /></button
					>
				</div>
			{:else}
				<button
					type="button"
					class="self-start text-xs text-fg-faint hover:text-fg-muted"
					onclick={() => edit(i, withSub(bullets[i]))}
				>
					+ sub-bullet
				</button>
			{/if}
		</div>
	{/snippet}
</ListEditor>
