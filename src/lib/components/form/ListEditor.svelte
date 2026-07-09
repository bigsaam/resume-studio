<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';
	import Icon from '../Icon.svelte';

	interface Props {
		items: T[];
		makeNew: () => T;
		row: Snippet<[T, number]>;
		addLabel?: string;
		onchange: () => void;
	}
	let { items = $bindable(), makeNew, row, addLabel = 'Add', onchange }: Props = $props();

	function move(i: number, delta: number) {
		const j = i + delta;
		if (j < 0 || j >= items.length) return;
		[items[i], items[j]] = [items[j], items[i]];
		onchange();
	}

	function remove(i: number) {
		items.splice(i, 1);
		onchange();
	}

	function add() {
		items.push(makeNew());
		onchange();
	}
</script>

<div class="flex flex-col gap-2">
	{#each items as item, i (i)}
		<div class="rounded-lg border border-line bg-bg p-3">
			<div class="mb-2 flex items-center justify-between">
				<span class="text-xs text-fg-faint">#{i + 1}</span>
				<div class="flex items-center gap-1">
					<button
						type="button"
						class="rounded p-1 text-fg-faint hover:bg-bg-hover hover:text-fg disabled:opacity-30"
						disabled={i === 0}
						onclick={() => move(i, -1)}
						aria-label="Move up">↑</button
					>
					<button
						type="button"
						class="rounded p-1 text-fg-faint hover:bg-bg-hover hover:text-fg disabled:opacity-30"
						disabled={i === items.length - 1}
						onclick={() => move(i, 1)}
						aria-label="Move down">↓</button
					>
					<button
						type="button"
						class="rounded p-1 text-fg-faint hover:bg-bg-hover hover:text-red-500"
						onclick={() => remove(i)}
						aria-label="Remove"><Icon name="x" size={14} /></button
					>
				</div>
			</div>
			{@render row(item, i)}
		</div>
	{/each}

	<button type="button" class="btn-ghost self-start !py-1.5 text-xs" onclick={add}>
		<Icon name="plus" size={14} />
		{addLabel}
	</button>
</div>
