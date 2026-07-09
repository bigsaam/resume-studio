<script lang="ts">
	import ResumeForm from '$lib/components/ResumeForm.svelte';
	import PdfPreview from '$lib/components/PdfPreview.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import type { PageData } from './$types';
	import type { ResumeData } from '$lib/server/templates/schema';

	let { data }: { data: PageData } = $props();

	// Deliberately a one-time snapshot: the form owns this copy from here on,
	// and we re-sync explicitly via reload() after a server-side revert.
	// svelte-ignore state_referenced_locally
	let resume = $state<ResumeData>(structuredClone(data.resume.data));
	// svelte-ignore state_referenced_locally
	let version = $state(data.resume.renderVersion);
	let building = $state(false);
	let error = $state<string | null>(null);
	let reverted = $state(false);

	let timer: ReturnType<typeof setTimeout> | undefined;

	/** Debounce: a burst of keystrokes becomes one save + one compile. */
	function scheduleSave() {
		clearTimeout(timer);
		timer = setTimeout(save, 700);
	}

	async function save() {
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
</script>

<svelte:head><title>{data.resume.title} · Resume Studio</title></svelte:head>

<div class="flex h-[calc(100vh-3rem)] flex-col gap-4">
	<div class="flex shrink-0 items-center justify-between gap-4">
		<div class="min-w-0">
			<a href="/resumes" class="text-xs text-fg-faint hover:text-fg-muted">← Resumes</a>
			<h1 class="truncate text-xl font-semibold tracking-tight">{data.resume.title}</h1>
		</div>
		<div class="flex items-center gap-2 text-xs">
			{#if reverted}
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
		<div class="min-h-0 overflow-y-auto rounded-xl border border-line bg-bg-soft px-4">
			<ResumeForm bind:data={resume} onchange={scheduleSave} />
		</div>

		<div class="min-h-0">
			<PdfPreview resumeId={data.resume.id} {version} {building} {error} />
		</div>
	</div>
</div>
