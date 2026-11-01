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
			// Cloudflare Web Analytics: cookieless page views. Keep "automatic setup" off for
			// the Pages project or every page view counts twice.
			head: [
				{
					tag: 'script',
					attrs: {
						defer: true,
						src: 'https://static.cloudflareinsights.com/beacon.min.js',
						'data-cf-beacon': '{"token": "82ff14a5563c492d869b6db741aac128"}',
					},
				},
			],
			customCss: ['./src/styles/docs.css'],
			expressiveCode: {
				themes: ['github-dark'],
			},
			components: {
				ThemeSelect: './src/components/docs/ThemeSelect.astro',
			},
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/gatefit/gatefit' },
			],
			sidebar: [
				{ label: 'Quickstart', slug: 'quickstart' },
				{ label: 'gatefit init', slug: 'init' },
				{ label: 'Goldens', slug: 'goldens' },
				{ label: 'GitHub Action', slug: 'action' },
				{ label: 'Polar pack', slug: 'polar-pack' },
				{ label: 'Telemetry', slug: 'telemetry' },
				{ label: 'Polar checkout', link: '/polar/' },
				{ label: 'Pricing', link: '/#pricing' },
			],
		}),
	],
});
