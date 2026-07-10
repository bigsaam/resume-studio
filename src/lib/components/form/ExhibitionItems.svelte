<script lang="ts">
	import ListEditor from './ListEditor.svelte';
	import type { Section } from '$lib/server/templates/schema';

	/** The `items[]` of one `exhibitions` entry. */
	type Item = NonNullable<Extract<Section, { kind: 'exhibitions' }>['entries'][number]['items']>[number];

	interface Props {
		/** Optional in the schema; the editor needs an array to bind to. */
		items: Item[] | undefined;
		onchange: () => void;
	}
	let { items = $bindable(), onchange }: Props = $props();

	// Materialise the array once, so `ListEditor` has something to bind. An empty
	// `items: []` is valid and renders as nothing, so this is not a visible edit.
	if (items === undefined) items = [];

	function update(i: number, patch: Partial<Item>) {
		items![i] = { ...items![i], ...patch };
		onchange();
	}

	function setSub(i: number, v: string) {
		const lines = v
			.split('\n')
			.map((s) => s.trim())
			.filter(Boolean);
		update(i, { sub: lines.length ? lines.slice(0, 10) : undefined });
	}
</script>

<div class="mt-1">
	<span class="label">Items</span>
	<ListEditor bind:items={items!} makeNew={() => ({ text: '' })} addLabel="Add item" {onchange}>
		{#snippet row(_item, i)}
			<div class="flex flex-col gap-2">
				<div class="flex gap-2">
					<input
						class="input flex-1"
						value={items![i].text}
						oninput={(e) => update(i, { text: e.currentTarget.value })}
						placeholder="Item — *bold* and -- en dash work"
					/>
					<input
						class="input w-32 shrink-0"
						value={items![i].date ?? ''}
						oninput={(e) => update(i, { date: e.currentTarget.value || undefined })}
						placeholder="2024"
					/>
				</div>
				<textarea
					class="input resize-y text-xs"
					rows="1"
					value={(items![i].sub ?? []).join('\n')}
					oninput={(e) => setSub(i, e.currentTarget.value)}
					placeholder="Sub-lines, one per line (optional)"></textarea>
			</div>
		{/snippet}
	</ListEditor>
</div>
