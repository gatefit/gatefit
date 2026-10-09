// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
	site: 'https://gatefit.io',
	base: '/',
	trailingSlash: 'ignore',
	integrations: [
		starlight({
			title: 'Gatefit',
			description:
				'Stripe Entitlement Edge Pack. CI that asserts the access DB survives ugly billing transitions.',
			favicon: '/favicon.svg',
			customCss: ['./src/styles/docs.css'],
			expressiveCode: {
				themes: ['github-dark'],
			},
			components: {
				ThemeSelect: './src/components/docs/ThemeSelect.astro',
			},
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/edipert/gatefit' },
			],
			sidebar: [
				{ label: 'Quickstart', slug: 'quickstart' },
				{ label: 'GitHub Action', slug: 'action' },
				{ label: 'Polar checkout', link: '/polar/' },
				{ label: 'Pricing', link: '/#pricing' },
			],
		}),
	],
});
