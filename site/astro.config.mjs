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
			// H35: the G mark beside the wordmark in the docs header.
			logo: { src: './src/assets/gatefit-mark.svg', alt: '' },
			// Cloudflare Web Analytics: cookieless page views. Keep "automatic setup" off for
			// the Pages project or every page view counts twice.
			head: [
				// H27: brand icons and the 1200x630 share card. Starlight already emits
				// og:title/description/url. Its default twitter:card is replaced by ours
				// below (Starlight dedupes meta by name), so the page keeps exactly one.
				// The svg icon repeats the favicon option with sizes="any" so it beats the ICO.
				{ tag: 'link', attrs: { rel: 'icon', href: '/favicon.ico', sizes: '32x32' } },
				{ tag: 'link', attrs: { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml', sizes: 'any' } },
				{ tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' } },
				{ tag: 'meta', attrs: { name: 'theme-color', content: '#0B1B3A' } },
				{ tag: 'meta', attrs: { property: 'og:image', content: 'https://gatefit.io/og.png' } },
				{ tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
				{ tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
				{ tag: 'meta', attrs: { property: 'og:image:alt', content: 'Gatefit. CI that asserts the access DB survives ugly billing transitions.' } },
				{ tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
				{ tag: 'meta', attrs: { name: 'twitter:image', content: 'https://gatefit.io/og.png' } },
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
				// H35: code frames on the brand navy, mint focus and copy feedback.
				styleOverrides: {
					borderRadius: '8px',
					borderColor: 'rgba(158, 184, 230, 0.14)',
					codeBackground: '#071330',
					codeFontFamily: "'Geist Mono Variable', ui-monospace, monospace",
					codeFontSize: '0.86rem',
					uiFontFamily: "'Geist Variable', sans-serif",
					focusBorder: '#5EE0A8',
					frames: {
						editorBackground: '#071330',
						terminalBackground: '#071330',
						editorTabBarBackground: '#0B1B3A',
						editorActiveTabBackground: '#071330',
						editorActiveTabIndicatorTopColor: '#5EE0A8',
						editorActiveTabIndicatorBottomColor: 'transparent',
						terminalTitlebarBackground: '#0B1B3A',
						terminalTitlebarBorderBottomColor: 'rgba(158, 184, 230, 0.14)',
						terminalTitlebarDotsForeground: '#5E7094',
						inlineButtonForeground: '#D3DCEB',
						inlineButtonBorder: 'rgba(158, 184, 230, 0.3)',
						tooltipSuccessBackground: '#5EE0A8',
						tooltipSuccessForeground: '#0B1B3A',
						frameBoxShadowCssValue: 'none',
					},
				},
			},
			components: {
				ThemeSelect: './src/components/docs/ThemeSelect.astro',
			},
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/gatefit/gatefit' },
			],
			sidebar: [
				{ label: 'Quickstart', slug: 'quickstart' },
				{ label: 'Onboarding', slug: 'onboarding' },
				{ label: 'gatefit init', slug: 'init' },
				{ label: 'Goldens', slug: 'goldens' },
				{ label: 'GitHub Action', slug: 'action' },
				{ label: 'Polar pack', slug: 'polar-pack' },
				{ label: 'Paddle pack', slug: 'paddle-pack' },
				{ label: 'Telemetry', slug: 'telemetry' },
				{ label: 'Polar checkout', link: '/polar/' },
				{ label: 'Pricing', link: '/#pricing' },
				{ label: 'Status', link: '/status/' },
			],
		}),
	],
});
