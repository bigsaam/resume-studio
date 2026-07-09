import type { Config } from 'tailwindcss';

// Token names are identical to mytube's, but each resolves to a CSS custom
// property instead of a literal hex. That keeps every `bg-bg`, `text-fg-muted`,
// `border-line`, `bg-accent/20` class working unchanged while letting the
// palette swap between light and dark (see src/app.css).
//
// Values are space-separated RGB channels ("15 15 15") rather than hex so
// Tailwind's slash-opacity syntax (`bg-bg/80`) still compiles.
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
	content: ['./src/**/*.{html,js,svelte,ts}'],
	darkMode: 'class',
	theme: {
		extend: {
			colors: {
				bg: {
					DEFAULT: token('bg'),
					soft: token('bg-soft'),
					raised: token('bg-raised'),
					hover: token('bg-hover')
				},
				line: token('line'),
				fg: {
					DEFAULT: token('fg'),
					muted: token('fg-muted'),
					faint: token('fg-faint')
				},
				accent: {
					DEFAULT: token('accent'),
					soft: token('accent-soft')
				}
			},
			fontFamily: {
				sans: ['Inter', 'system-ui', 'sans-serif']
			}
		}
	},
	plugins: []
} satisfies Config;
