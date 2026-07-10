import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import svelteParser from 'svelte-eslint-parser';

/**
 * ESLint 9 flat config. There wasn't one, so `pnpm lint` could never run.
 *
 * Formatting is Prettier's job — `eslint-config-prettier` turns off every rule
 * that would argue with it. What's left is the set of rules that catch mistakes
 * rather than opinions.
 */
export default ts.config(
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs['flat/recommended'],
	prettier,
	...svelte.configs['flat/prettier'],

	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node }
		},
		rules: {
			// `_`-prefixed arguments are deliberately unused — snippet params, and
			// the handlers whose signature is fixed by a library.
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }
			],
			// The codebase uses `!` where a throwing guard has already proved the
			// value non-null (`requireOwnedResume`, `locals.user`). Those are marked.
			'@typescript-eslint/no-non-null-assertion': 'off'
		}
	},

	{
		files: ['**/*.svelte', '**/*.svelte.ts'],
		languageOptions: {
			parser: svelteParser,
			parserOptions: { parser: ts.parser, svelteConfig: './svelte.config.js' }
		},
		rules: {
			// This rule exists so that `<a href="/x">` doesn't break when the app is
			// served under a base path. `svelte.config.js` sets no `paths.base`, and
			// the app is deployed at a domain root, so there is nothing to resolve.
			// Turn it back on the day a base path appears.
			'svelte/no-navigation-without-resolve': 'off'
		}
	},

	{
		files: ['**/*.test.ts', 'vitest.setup.ts'],
		rules: {
			// Tests reach into internals and assert on loose shapes on purpose.
			'@typescript-eslint/no-explicit-any': 'off'
		}
	},

	{
		ignores: [
			'build/',
			'.svelte-kit/',
			'node_modules/',
			'data/',
			'vendor/',
			'drizzle/',
			'static/',
			'*.config.js'
		]
	}
);
