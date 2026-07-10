<script lang="ts">
	import { page } from '$app/stores';
	import Icon from './Icon.svelte';
	import ThemeToggle from './ThemeToggle.svelte';

	interface Props {
		user: { name: string | null; email: string; picture: string | null } | null;
		resumeCount?: number;
	}
	let { user, resumeCount = 0 }: Props = $props();

	let nav = $derived([
		{ href: '/resumes', label: 'Resumes', icon: 'resumes', badge: resumeCount },
		{ href: '/templates', label: 'Templates', icon: 'templates', badge: 0 },
		{ href: '/settings', label: 'Settings', icon: 'settings', badge: 0 }
	]);

	function active(href: string): boolean {
		const p = $page.url.pathname;
		return p === href || p.startsWith(href + '/');
	}
</script>

<aside class="flex h-full w-56 shrink-0 flex-col border-r border-line bg-bg px-3 py-4">
	<a href="/resumes" class="mb-6 flex items-center gap-2 px-2">
		<div class="grid h-8 w-8 place-items-center rounded-lg bg-accent text-white">
			<Icon name="resumes" size={18} />
		</div>
		<span class="text-lg font-semibold tracking-tight">Resume Studio</span>
	</a>

	<nav class="flex flex-col gap-1">
		{#each nav as item (item.href)}
			<a
				href={item.href}
				class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors
					{active(item.href) ? 'bg-bg-raised font-medium text-fg' : 'text-fg-muted hover:bg-bg-soft hover:text-fg'}"
			>
				<Icon name={item.icon} size={18} />
				<span class="flex-1">{item.label}</span>
				{#if item.badge > 0}
					<span class="rounded-full bg-bg-hover px-1.5 py-0.5 text-xs tabular-nums text-fg-muted">
						{item.badge}
					</span>
				{/if}
			</a>
		{/each}
	</nav>

	<div class="mt-auto flex flex-col gap-1 pt-4">
		<ThemeToggle />
		{#if user}
			<a
				href="/logout"
				data-sveltekit-reload
				class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-fg-muted transition-colors hover:bg-bg-soft hover:text-fg"
			>
				<Icon name="logout" size={18} />
				<span>Sign out</span>
			</a>
			<div class="mt-2 flex items-center gap-2 px-3 pt-2">
				{#if user.picture}
					<img src={user.picture} alt="" class="h-6 w-6 rounded-full" referrerpolicy="no-referrer" />
				{/if}
				<span class="truncate text-xs text-fg-faint" title={user.email}>
					{user.name ?? user.email}
				</span>
			</div>
		{/if}
	</div>
</aside>
