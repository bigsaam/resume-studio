<script lang="ts">
	import ListEditor from './ListEditor.svelte';
	import type { Bullet } from '$lib/server/templates/schema';

	interface Props {
		bullets: Bullet[];
		onchange: () => void;
	}
	let { bullets = $bindable(), onchange }: Props = $props();

	// A bullet is `string | {text, date?, sub?}`. Editing a mixed list is
	// confusing, so once any bullet carries a date we treat the whole list as
	// dated and show the date column for all of them.
	let dated = $derived(bullets.some((b) => typeof b === 'object'));

	function textOf(b: Bullet): string {
		return typeof b === 'string' ? b : b.text;
	}
	function dateOf(b: Bullet): string {
		return typeof b === 'string' ? '' : (b.date ?? '');
	}
	function subOf(b: Bullet): string[] {
		return typeof b === 'string' ? [] : (b.sub ?? []);
	}

	function setText(i: number, v: string) {
		const b = bullets[i];
		bullets[i] = typeof b === 'string' ? v : { ...b, text: v };
		onchange();
	}
	function setDate(i: number, v: string) {
		const b = bullets[i];
		const base = typeof b === 'string' ? { text: b } : b;
		bullets[i] = { ...base, date: v };
		onchange();
	}
	function setSub(i: number, v: string) {
		const b = bullets[i];
		const base = typeof b === 'string' ? { text: b } : b;
		const sub = v
			.split('\n')
			.map((s) => s.trim())
			.filter(Boolean);
		bullets[i] = sub.length ? { ...base, sub } : { ...base, sub: undefined };
		onchange();
	}
</script>

<ListEditor bind:items={bullets} makeNew={() => (dated ? { text: '', date: '' } : '')} addLabel="Add bullet" {onchange}>
	{#snippet row(_b, i)}
		<div class="flex flex-col gap-2">
			<div class="flex gap-2">
				<textarea
					class="input min-h-[2.5rem] flex-1 resize-y"
					rows="2"
					value={textOf(bullets[i])}
					oninput={(e) => setText(i, e.currentTarget.value)}
					placeholder="Bullet text — *bold* and -- en dash work"
				></textarea>
				{#if dated}
					<input
						class="input w-40 shrink-0 self-start"
						value={dateOf(bullets[i])}
						oninput={(e) => setDate(i, e.currentTarget.value)}
						placeholder="Jan. 2024"
					/>
				{/if}
			</div>
			{#if subOf(bullets[i]).length > 0}
				<textarea
					class="input resize-y text-xs"
					rows="2"
					value={subOf(bullets[i]).join('\n')}
					oninput={(e) => setSub(i, e.currentTarget.value)}
					placeholder="Sub-bullets, one per line"
				></textarea>
			{:else}
				<button type="button" class="self-start text-xs text-fg-faint hover:text-fg-muted" onclick={() => setSub(i, ' ')}>
					+ sub-bullet
				</button>
			{/if}
		</div>
	{/snippet}
</ListEditor>
