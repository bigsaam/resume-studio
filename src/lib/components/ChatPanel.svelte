<script lang="ts">
	import { tick } from 'svelte';
	import Icon from './Icon.svelte';
	// Type-only: erased at build time, so this does not pull server code into the
	// bundle. It keeps the NDJSON reader honest against the server's event union.
	import type { AgentEvent } from '$lib/server/agent/events';

	export interface ChatTurn {
		role: 'user' | 'assistant';
		text: string;
	}

	interface Props {
		resumeId: number;
		enabled: boolean;
		history: ChatTurn[];
		/** A compile finished — bump the PDF cache-buster. */
		onrender: (version: number) => void;
		/** The agent changed the résumé; re-sync the form from the server. */
		onapplied: () => Promise<void>;
		/** Streaming started or stopped; the form pauses its auto-save meanwhile. */
		onbusy: (busy: boolean) => void;
	}
	let { resumeId, enabled, history, onrender, onapplied, onbusy }: Props = $props();

	// svelte-ignore state_referenced_locally
	let messages = $state<ChatTurn[]>([...history]);
	let draft = $state('');
	let streaming = $state<string | null>(null);
	let status = $state<string | null>(null);
	let errorText = $state<string | null>(null);
	let busy = $state(false);
	let scroller = $state<HTMLDivElement | null>(null);

	let controller: AbortController | null = null;
	/** Set by `cancel()`. A cancelled turn's partial text is thrown away. */
	let cancelled = false;

	async function scrollDown() {
		await tick();
		scroller?.scrollTo({ top: scroller.scrollHeight });
	}

	function setBusy(v: boolean) {
		busy = v;
		onbusy(v);
	}

	async function send() {
		const text = draft.trim();
		if (!text || busy) return;

		draft = '';
		errorText = null;
		cancelled = false;
		messages = [...messages, { role: 'user', text }];
		streaming = '';
		status = 'Thinking…';
		setBusy(true);
		void scrollDown();

		controller = new AbortController();
		let edited = false;

		try {
			const res = await fetch(`/api/resumes/${resumeId}/chat`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ message: text }),
				signal: controller.signal
			});

			if (!res.ok || !res.body) {
				const body = await res.json().catch(() => null);
				errorText = body?.error ?? `The assistant could not be reached (${res.status}).`;
				return;
			}

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });

				// NDJSON: one event per line, and the last line may be a fragment.
				let nl: number;
				while ((nl = buffer.indexOf('\n')) !== -1) {
					const line = buffer.slice(0, nl).trim();
					buffer = buffer.slice(nl + 1);
					if (!line) continue;

					let event: AgentEvent;
					try {
						event = JSON.parse(line) as AgentEvent;
					} catch {
						continue; // Skip one unreadable line rather than the whole turn.
					}
					edited = handleEvent(event, edited);
					void scrollDown();
				}
			}
		} catch (err) {
			if (!(err instanceof DOMException && err.name === 'AbortError')) {
				errorText = 'The connection dropped. Please try again.';
			}
		} finally {
			// A cancelled turn's partial text is never persisted server-side, so
			// don't leave it here masquerading as a saved reply.
			if (streaming && !cancelled) messages = [...messages, { role: 'assistant', text: streaming }];
			streaming = null;
			status = null;
			controller = null;
			setBusy(false);
			// The agent may have edited and rendered before it was stopped.
			if (edited) await onapplied();
			void scrollDown();
		}
	}

	function handleEvent(ev: AgentEvent, edited: boolean): boolean {
		switch (ev.type) {
			case 'status':
				status = ev.text;
				return edited;
			case 'delta':
				streaming = (streaming ?? '') + ev.text;
				return edited;
			case 'tool':
				if (ev.name === 'edit_resume' && ev.ok) {
					status = 'Applying changes…';
					return true;
				}
				if (ev.name === 'get_resume') status = 'Reading your résumé…';
				return edited;
			case 'render':
				onrender(ev.version);
				status = ev.ok ? 'Rendered.' : 'That did not typeset — retrying…';
				return edited;
			case 'done':
				if (ev.reverted) errorText = 'That change broke the layout, so it was undone.';
				status = null;
				if (ev.text) {
					messages = [...messages, { role: 'assistant', text: ev.text }];
					streaming = null;
				}
				onrender(ev.version);
				return edited;
			case 'error':
				errorText = ev.message;
				// The server does not persist a failed turn's partial text, so don't
				// leave it on screen pretending to be a saved reply.
				streaming = null;
				status = null;
				return edited;
		}
	}

	function cancel() {
		// The server discards a cancelled turn's partial text, so drop it here too
		// — otherwise `send()`'s cleanup promotes it to a chat bubble that vanishes
		// on the next page load.
		cancelled = true;
		streaming = null;
		controller?.abort();
	}

	async function clearConversation() {
		if (busy) return;
		const res = await fetch(`/api/resumes/${resumeId}/chat`, { method: 'DELETE' });
		if (res.ok) {
			messages = [];
			errorText = null;
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			void send();
		}
	}
</script>

<div class="flex h-full min-h-0 flex-col">
	{#if !enabled}
		<div class="m-3 rounded-lg border border-dashed border-line p-4 text-sm text-fg-faint">
			<p class="mb-1 flex items-center gap-2 font-medium text-fg-muted">
				<Icon name="chat" size={16} /> Chat is off
			</p>
			<p>This server has no Anthropic credentials configured, so the assistant is unavailable.</p>
		</div>
	{:else}
		<div bind:this={scroller} class="min-h-0 flex-1 space-y-3 overflow-y-auto px-1 py-3">
			{#if messages.length === 0 && !streaming}
				<div class="rounded-lg border border-dashed border-line p-4 text-sm text-fg-faint">
					<p class="mb-1 font-medium text-fg-muted">Ask for a change</p>
					<p>“Tighten the bio to two sentences.” · “Move Education above Experience.” · “Make the sidebar warmer.”</p>
				</div>
			{/if}

			{#each messages as m (m)}
				<div class="flex" class:justify-end={m.role === 'user'}>
					<div
						class="max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm"
						class:bg-accent={m.role === 'user'}
						class:text-white={m.role === 'user'}
						class:bg-bg-raised={m.role === 'assistant'}
					>
						{m.text}
					</div>
				</div>
			{/each}

			{#if streaming}
				<div class="flex">
					<div class="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-bg-raised px-3 py-2 text-sm">{streaming}</div>
				</div>
			{/if}

			{#if status}
				<p class="flex items-center gap-2 px-1 text-xs text-fg-faint">
					<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-accent"></span>{status}
				</p>
			{/if}

			{#if errorText}
				<div class="rounded-lg bg-red-500/10 p-3 text-xs text-red-500">
					<p class="flex items-center gap-2"><Icon name="warning" size={14} /> {errorText}</p>
				</div>
			{/if}
		</div>

		<div class="shrink-0 border-t border-line pt-3">
			<textarea
				bind:value={draft}
				onkeydown={onKeydown}
				disabled={busy}
				rows="3"
				placeholder="Ask for a change…"
				class="input resize-none text-sm"
			></textarea>
			<div class="mt-2 flex items-center justify-between">
				<button
					type="button"
					class="btn-ghost !px-2 !py-1 text-xs"
					onclick={clearConversation}
					disabled={busy || messages.length === 0}
				>
					<Icon name="trash" size={13} /> Clear
				</button>
				{#if busy}
					<button type="button" class="btn-ghost !px-3 !py-1 text-xs" onclick={cancel}>
						<Icon name="x" size={13} /> Stop
					</button>
				{:else}
					<button type="button" class="btn-primary !px-3 !py-1 text-xs" onclick={send} disabled={!draft.trim()}>
						Send
					</button>
				{/if}
			</div>
		</div>
	{/if}
</div>
