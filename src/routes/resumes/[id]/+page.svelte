<script lang="ts">
	import ResumeForm from '$lib/components/ResumeForm.svelte';
	import ChatPanel from '$lib/components/ChatPanel.svelte';
	import PdfPreview from '$lib/components/PdfPreview.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import type { PageData } from './$types';
	import type { ResumeData } from '$lib/server/templates/schema';

	let { data }: { data: PageData } = $props();

	// Deliberately a one-time snapshot: the form owns this copy from here on,
	// and we re-sync explicitly via reload() after a server-side revert or an
	// edit made by the chat agent.
	// svelte-ignore state_referenced_locally
	let resume = $state<ResumeData>(structuredClone(data.resume.data));
	// svelte-ignore state_referenced_locally
	let version = $state(data.resume.renderVersion);
	let building = $state(false);
	let error = $state<string | null>(null);
	let reverted = $state(false);

	let tab = $state<'edit' | 'chat'>('edit');
	/** The agent holds the per-résumé lock; a form save would only 409. */
	let agentBusy = $state(false);

	// svelte-ignore state_referenced_locally
	let title = $state(data.resume.title);

	/**
	 * The title is metadata, not résumé content: renaming doesn't recompile and
	 * doesn't take the per-résumé lock, so it can't collide with a chat turn.
	 */
	async function renameTo(next: string) {
		const clean = next.trim();
		if (!clean || clean === data.resume.title) {
			title = data.resume.title;
			return;
		}
		const res = await fetch(`/api/resumes/${data.resume.id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ title: clean })
		});
		if (!res.ok) {
			title = data.resume.title; // put the old one back
			return;
		}
		const body = await res.json();
		title = body.title;
		data.resume.title = body.title;
	}

	let timer: ReturnType<typeof setTimeout> | undefined;

	/** Debounce: a burst of keystrokes becomes one save + one compile. */
	function scheduleSave() {
		clearTimeout(timer);
		timer = setTimeout(save, 700);
	}

	async function save() {
		if (agentBusy) return;
		building = true;
		reverted = false;
		try {
			const res = await fetch(`/api/resumes/${data.resume.id}/data`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ data: resume })
			});
			const body = await res.json();

			if (res.status === 409) {
				error = 'Another change is still saving. Try again in a moment.';
				return;
			}

			// A revert is its own outcome, not a failure: the resume still compiles
			// (`ok` is true), but the edit was thrown away. Resync the form so it
			// stops showing content the resume no longer has.
			if (body.reverted) {
				reverted = true;
				error = body.log || 'That change broke the layout, so it was undone.';
				await reload();
				return;
			}

			if (!res.ok || !body.ok) {
				error = body.error || body.log || 'Could not save.';
				return;
			}

			error = null;
			version = body.version;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Network error';
		} finally {
			building = false;
		}
	}

	async function reload() {
		const res = await fetch(`/api/resumes/${data.resume.id}/data`);
		if (!res.ok) return;
		const body = await res.json();
		resume = body.data;
		version = body.renderVersion;
	}

	function onAgentRender(v: number) {
		// A failed compile reports the version it did not advance past.
		if (v > version) version = v;
	}

	async function onAgentApplied() {
		error = null;
		await reload();
	}
</script>

<svelte:head><title>{title} · Resume Studio</title></svelte:head>

<div class="flex h-[calc(100vh-3rem)] flex-col gap-4">
	<div class="flex shrink-0 items-center justify-between gap-4">
		<div class="min-w-0">
			<a href="/resumes" class="text-xs text-fg-faint hover:text-fg-muted">← Resumes</a>
			<input
				class="w-full truncate rounded border border-transparent bg-transparent px-1 text-xl font-semibold tracking-tight hover:border-line focus:border-line focus:outline-none"
				bind:value={title}
				aria-label="Resume title"
				onblur={() => renameTo(title)}
				onkeydown={(e) => {
					if (e.key === 'Enter') e.currentTarget.blur();
					if (e.key === 'Escape') {
						title = data.resume.title;
						e.currentTarget.blur();
					}
				}}
			/>
		</div>
		<div class="flex items-center gap-2 text-xs">
			{#if agentBusy}
				<span class="chip"><Icon name="chat" size={13} /> Assistant is editing…</span>
			{:else if reverted}
				<span class="chip !bg-red-500/10 !text-red-500">
					<Icon name="warning" size={13} /> Reverted — that change broke the layout
				</span>
			{:else if building}
				<span class="chip">Saving…</span>
			{:else if error}
				<span class="chip !bg-red-500/10 !text-red-500">Not saved</span>
			{:else}
				<span class="chip"><Icon name="check" size={13} /> Saved</span>
			{/if}
			<span class="chip">{data.resume.templateName}</span>
		</div>
	</div>

	<div class="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,26rem)_1fr]">
		<div class="flex min-h-0 flex-col rounded-xl border border-line bg-bg-soft px-4">
			<div class="flex shrink-0 gap-1 border-b border-line pt-2 text-sm">
				<button
					type="button"
					class="rounded-t-lg px-3 py-2 font-medium"
					class:text-accent={tab === 'edit'}
					class:text-fg-faint={tab !== 'edit'}
					onclick={() => (tab = 'edit')}
				>
					Edit
				</button>
				<button
					type="button"
					class="flex items-center gap-1.5 rounded-t-lg px-3 py-2 font-medium"
					class:text-accent={tab === 'chat'}
					class:text-fg-faint={tab !== 'chat'}
					onclick={() => (tab = 'chat')}
				>
					<Icon name="chat" size={14} /> Chat
				</button>
			</div>

			<!-- Both stay mounted: switching tabs must not drop a streaming turn
			     or the form's in-progress edits. -->
			<div class="min-h-0 flex-1 overflow-y-auto" class:hidden={tab !== 'edit'}>
				<ResumeForm bind:data={resume} onchange={scheduleSave} />
			</div>
			<div class="min-h-0 flex-1" class:hidden={tab !== 'chat'}>
				<ChatPanel
					resumeId={data.resume.id}
					enabled={data.chat.enabled}
					history={data.chat.history}
					onrender={onAgentRender}
					onapplied={onAgentApplied}
					onbusy={(b) => (agentBusy = b)}
				/>
			</div>
		</div>

		<div class="min-h-0">
			<PdfPreview resumeId={data.resume.id} {version} building={building || agentBusy} {error} />
		</div>
	</div>
</div>
