<script lang="ts">
	import Field from './form/Field.svelte';
	import ListEditor from './form/ListEditor.svelte';
	import BulletList from './form/BulletList.svelte';
	import type { ResumeData } from '$lib/server/templates/schema';

	interface Props {
		data: ResumeData;
		onchange: () => void;
	}
	let { data = $bindable(), onchange }: Props = $props();

	// Must exist in `fonts/` — Typst resolves by the font's internal family name.
	const FONTS = [
		'Libre Baskerville',
		'Lora',
		'EB Garamond',
		'Source Serif 4',
		'Merriweather',
		'Alegreya',
		'Vollkorn',
		'Bitter',
		'Nunito Sans',
		'Inter',
		'Work Sans',
		'Rubik',
		'Roboto',
		'Montserrat'
	];
	const ICONS = ['email', 'phone', 'website', 'instagram', 'github'] as const;

	let open = $state<Record<string, boolean>>({ design: false, header: true, sections: true });
	const toggle = (k: string) => (open[k] = !open[k]);
</script>

{#snippet group(key: string, title: string, body: import('svelte').Snippet)}
	<section class="border-b border-line">
		<button
			type="button"
			class="flex w-full items-center justify-between px-1 py-3 text-left text-sm font-medium hover:text-accent"
			onclick={() => toggle(key)}
		>
			{title}
			<span class="text-fg-faint">{open[key] ? '−' : '+'}</span>
		</button>
		{#if open[key]}
			<div class="flex flex-col gap-3 pb-5 pt-1">{@render body()}</div>
		{/if}
	</section>
{/snippet}

<div class="flex flex-col">
	<!-- ---------------------------------------------------------- design -->
	{#snippet designBody()}
		<div class="grid grid-cols-2 gap-3">
			<Field label="Text" type="color" bind:value={data.theme.colors.text} {onchange} />
			<Field label="Headings" type="color" bind:value={data.theme.colors.heading} {onchange} />
			<Field label="Name" type="color" bind:value={data.theme.colors.name} {onchange} />
			<Field label="Sidebar" type="color" bind:value={data.theme.colors.sidebar} {onchange} />
		</div>

		<div class="grid grid-cols-2 gap-3">
			{#each [['body', 'Body font'], ['heading', 'Heading font'], ['secondary', 'Secondary font'], ['name', 'Name font']] as [k, label] (k)}
				<label class="block">
					<span class="label">{label}</span>
					<select
						class="input"
						value={(data.theme.fonts as Record<string, string>)[k] ?? ''}
						onchange={(e) => {
							(data.theme.fonts as Record<string, string>)[k] = e.currentTarget.value;
							onchange();
						}}
					>
						{#if k === 'name'}<option value="">(same as body)</option>{/if}
						{#each FONTS as f (f)}<option value={f}>{f}</option>{/each}
					</select>
				</label>
			{/each}
		</div>

		<div class="grid grid-cols-2 gap-3">
			<Field label="Name size (pt)" type="number" step={0.5} bind:value={data.theme.nameSize} {onchange} />
			<Field label="Body size (pt)" type="number" step={0.5} bind:value={data.theme.bodySize} {onchange} />
			<Field label="Photo width (%)" type="number" bind:value={data.theme.photoWidthPct} {onchange} />
			<Field label="Photo border (pt)" type="number" step={0.5} bind:value={data.theme.photoBorderWidth} {onchange} />
		</div>
		<Field label="Photo border colour" type="color" bind:value={data.theme.photoBorderColor} {onchange} />
	{/snippet}
	{@render group('design', 'Design', designBody)}

	<!-- ---------------------------------------------------------- header -->
	{#snippet headerBody()}
		<div class="grid grid-cols-2 gap-3">
			<Field label="First name" bind:value={data.header.firstName} {onchange} />
			<Field label="Last name" bind:value={data.header.lastName} {onchange} />
		</div>
		<Field label="Profession" bind:value={data.header.profession} {onchange} />
		<label class="block">
			<span class="label">Bio</span>
			<textarea class="input resize-y" rows="4" bind:value={data.header.bio} oninput={onchange}></textarea>
		</label>
		<Field label="Photo caption" bind:value={data.header.photoCaption} {onchange} />
	{/snippet}
	{@render group('header', 'Header', headerBody)}

	<!-- --------------------------------------------------------- contact -->
	{#snippet contactBody()}
		<ListEditor
			bind:items={data.contact}
			makeNew={() => ({ icon: 'email' as const, text: '', href: '' })}
			addLabel="Add contact"
			{onchange}
		>
			{#snippet row(_c, i)}
				<div class="grid grid-cols-[7rem_1fr] gap-2">
					<label class="block">
						<span class="label">Icon</span>
						<select class="input" bind:value={data.contact[i].icon} onchange={onchange}>
							{#each ICONS as ic (ic)}<option value={ic}>{ic}</option>{/each}
						</select>
					</label>
					<div class="flex flex-col gap-2">
						<Field label="Text" bind:value={data.contact[i].text} {onchange} />
						<Field label="Link" bind:value={data.contact[i].href} {onchange} placeholder="mailto: / tel: / https:" />
					</div>
				</div>
			{/snippet}
		</ListEditor>
	{/snippet}
	{@render group('contact', 'Contact', contactBody)}

	<!-- ------------------------------------------------------- education -->
	{#snippet eduBody()}
		<ListEditor
			bind:items={data.education}
			makeNew={() => ({ logo: '', logoWidth: 30, date: '', lines: ['*Degree*'] })}
			addLabel="Add education"
			{onchange}
		>
			{#snippet row(_e, i)}
				<div class="flex flex-col gap-2">
					<Field label="Date" bind:value={data.education[i].date} {onchange} placeholder="Jun. 2016" />
					<label class="block">
						<span class="label">Lines (one per line; first is bold)</span>
						<textarea
							class="input resize-y"
							rows="3"
							value={data.education[i].lines.join('\n')}
							oninput={(e) => {
								data.education[i].lines = e.currentTarget.value.split('\n');
								onchange();
							}}
						></textarea>
					</label>
				</div>
			{/snippet}
		</ListEditor>
	{/snippet}
	{@render group('education', 'Education', eduBody)}

	<!-- ------------------------------------------------------- languages -->
	{#snippet langBody()}
		<ListEditor
			bind:items={data.languages}
			makeNew={() => ({ language: '', level: '' })}
			addLabel="Add language"
			{onchange}
		>
			{#snippet row(_l, i)}
				<div class="grid grid-cols-2 gap-2">
					<Field label="Language" bind:value={data.languages[i].language} {onchange} />
					<Field label="Level" bind:value={data.languages[i].level} {onchange} />
				</div>
			{/snippet}
		</ListEditor>

		<label class="mt-2 block">
			<span class="label">Hobbies (comma separated)</span>
			<input
				class="input"
				value={(data.hobbies ?? []).join(', ')}
				oninput={(e) => {
					data.hobbies = e.currentTarget.value
						.split(',')
						.map((s) => s.trim())
						.filter(Boolean);
					onchange();
				}}
			/>
		</label>
	{/snippet}
	{@render group('languages', 'Languages & hobbies', langBody)}

	<!-- -------------------------------------------------------- sections -->
	{#snippet sectionsBody()}
		<!-- Bind through `section` rather than `data.sections[i]`: the each-item is
		     the same $state proxy, and narrowing on `section.kind` gives the
		     per-kind fields their types. -->
		{#each data.sections as section, si (si)}
			<div class="rounded-lg border border-line bg-bg p-3">
				<div class="mb-3 flex items-center gap-2">
					<input class="input flex-1 font-medium" bind:value={section.title} oninput={onchange} />
					<span class="chip shrink-0">{section.kind}</span>
					<select class="input w-20 shrink-0" bind:value={section.page} onchange={onchange}>
						<option value={1}>p1</option>
						<option value={2}>p2</option>
					</select>
				</div>

				{#if section.kind === 'work'}
					<ListEditor
						bind:items={section.entries}
						makeNew={() => ({
							timeframe: '',
							title: '',
							titleNote: '',
							organization: '',
							location: '',
							bullets: ['']
						})}
						addLabel="Add role"
						{onchange}
					>
						{#snippet row(entry, _ei)}
							<div class="flex flex-col gap-2">
								<div class="grid grid-cols-2 gap-2">
									<Field label="Title" bind:value={entry.title} {onchange} />
									<Field label="Timeframe" bind:value={entry.timeframe} {onchange} />
									<Field label="Organization" bind:value={entry.organization} {onchange} />
									<Field label="Location" bind:value={entry.location} {onchange} />
								</div>
								{#if entry.bullets}
									<BulletList bind:bullets={entry.bullets} {onchange} />
								{:else}
									<label class="block">
										<span class="label">Body</span>
										<textarea class="input resize-y" rows="2" bind:value={entry.body} oninput={onchange}></textarea>
									</label>
								{/if}
							</div>
						{/snippet}
					</ListEditor>
				{:else if section.kind === 'bullets' || section.kind === 'bullets-2col'}
					<BulletList bind:bullets={section.bullets} {onchange} />
				{:else if section.kind === 'exhibitions'}
					<ListEditor
						bind:items={section.entries}
						makeNew={() => ({ title: '', meta: '', date: '', items: [] })}
						addLabel="Add entry"
						{onchange}
					>
						{#snippet row(entry, _ei)}
							<div class="flex flex-col gap-2">
								<Field label="Title" bind:value={entry.title} {onchange} />
								<div class="grid grid-cols-2 gap-2">
									<Field label="Meta" bind:value={entry.meta} {onchange} />
									<Field label="Date" bind:value={entry.date} {onchange} />
								</div>
							</div>
						{/snippet}
					</ListEditor>
				{/if}
			</div>
		{/each}
	{/snippet}
	{@render group('sections', 'Sections', sectionsBody)}
</div>
