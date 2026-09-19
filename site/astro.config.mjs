// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
	site: 'https://edipert.github.io',
	base: '/gatefit',
	integrations: [
		starlight({
			title: 'Gatefit',
			description:
				'Stripe Entitlement Edge Pack — CI that asserts the access DB survives ugly billing transitions.',
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/edipert/gatefit' },
			],
			sidebar: [
				{ label: 'Quickstart', slug: 'quickstart' },
				{ label: 'GitHub Action', slug: 'action' },
				{ label: 'Polar checkout', slug: 'polar' },
			],
		}),
	],
});
