<script lang="ts">
	import Icon from './Icon.svelte';

	// The inline script in app.html already stamped a class on <html> before
	// paint; read it back rather than re-deriving, so we never disagree with it.
	let theme = $state<'light' | 'dark'>('light');

	$effect(() => {
		theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
	});

	function toggle() {
		theme = theme === 'dark' ? 'light' : 'dark';
		const root = document.documentElement;
		root.classList.remove('light', 'dark');
		root.classList.add(theme);
		try {
			localStorage.setItem('theme', theme);
		} catch {
			/* private mode — the choice just won't persist */
		}
	}
</script>

<button
	type="button"
	onclick={toggle}
	class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-fg-muted transition-colors hover:bg-bg-soft hover:text-fg"
	aria-label="Switch to {theme === 'dark' ? 'light' : 'dark'} mode"
	title="Switch to {theme === 'dark' ? 'light' : 'dark'} mode"
>
	<Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
	<span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
</button>
