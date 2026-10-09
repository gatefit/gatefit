import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ScrollToPlugin } from 'gsap/ScrollToPlugin';

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);
ScrollTrigger.config({ limitCallbacks: true, ignoreMobileResize: true });

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (!reduced) boot();

function boot() {
	const mm = gsap.matchMedia();
	mm.add('(min-width: 900px)', () => {
		gsap.to('.hero-copy', {
			yPercent: -8,
			ease: 'none',
			scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: 0.4 },
		});
		gsap.to('.hero-sim', {
			yPercent: -16,
			ease: 'none',
			scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: 0.4 },
		});
		gsap.to('.hero-field', {
			yPercent: 10,
			ease: 'none',
			scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: 0.4 },
		});
	});

	initLeak();
	initHow();
	initTiles();
	initPricing();
	initSim();
	initLoops();
	initSpotlight();
	initCopy();
}

function initLeak() {
	const supports = CSS.supports('animation-timeline: view()');
	const buttons = document.querySelectorAll<HTMLButtonElement>('[data-leak-jump]');
	if (supports) {
		buttons.forEach((btn) => {
			btn.addEventListener('click', () => {
				const snaps = document.querySelectorAll('.leak-snap');
				const index = Number(btn.dataset.leakIndex ?? '0');
				snaps[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
			});
		});
		return;
	}

	const mm = gsap.matchMedia();
	mm.add('(prefers-reduced-motion: no-preference) and (min-width: 900px)', () => {
		const tl = gsap.timeline({
			scrollTrigger: {
				trigger: '#leak',
				pin: '#leak-stage',
				start: 'top top',
				end: '+=300%',
				scrub: 0.6,
				anticipatePin: 1,
				snap: {
					snapTo: [0, 0.2, 0.4, 0.6, 0.8, 1],
					duration: { min: 0.2, max: 0.5 },
					ease: 'power2.inOut',
					delay: 0.08,
				},
				onToggle: (self) => {
					const stage = document.querySelector<HTMLElement>('#leak-stage');
					if (stage) stage.style.willChange = self.isActive ? 'transform' : 'auto';
				},
			},
		});
		tl.addLabel('refund', 0)
			.to('#node-stripe .ring', { opacity: 1, scale: 1.02 }, 'refund')
			.addLabel('webhook', 1)
			.to('#conn-1', { scaleX: 1 }, 'webhook')
			.to('#node-hook .ring', { opacity: 1 }, 'webhook')
			.to('#node-hook', { opacity: 1 }, 'webhook')
			.addLabel('leak', 2)
			.to('#conn-2', { scaleX: 1 }, 'leak')
			.to('#node-db .red', { opacity: 1 }, 'leak')
			.to('#node-db', { opacity: 1 }, 'leak')
			.addLabel('caught', 3)
			.to('#conn-3', { scaleX: 1 }, 'caught')
			.to('#node-ci .red', { opacity: 1 }, 'caught')
			.to('#node-ci', { opacity: 1 }, 'caught')
			.addLabel('fixed', 4)
			.to(['#node-db .green', '#node-ci .green', '.conn .green'], { opacity: 1 }, 'fixed')
			.to({}, { duration: 1 });

		const st = tl.scrollTrigger;
		buttons.forEach((btn) => {
			btn.addEventListener('click', () => {
				if (!st) return;
				const frac = Number(btn.dataset.leakJump ?? '0');
				const y = st.start + (st.end - st.start) * frac;
				gsap.to(window, { scrollTo: y, duration: 0.8, ease: 'power2.inOut' });
			});
		});
		return () => {
			const stage = document.querySelector<HTMLElement>('#leak-stage');
			if (stage) stage.style.willChange = 'auto';
		};
	});
}

function initHow() {
	const mm = gsap.matchMedia();
	mm.add('(min-width: 900px)', () => {
		const lines = gsap.utils.toArray<HTMLElement>('.pane.is-on .how-inner');
		const bar = document.querySelector('.how-bar');
		const layer = document.querySelector('.uses-layer');
		const cmd = document.querySelector('.out-cmd span');
		const ok = document.querySelector('.out-ok');
		ScrollTrigger.create({
			trigger: '.how-window',
			start: 'top 70%',
			once: true,
			onEnter: () => {
				gsap.fromTo(lines, { xPercent: -100 }, {
					xPercent: 0,
					duration: 0.45,
					stagger: 0.055,
					ease: 'expo.out',
					onComplete: () => {
						if (bar) gsap.to(bar, { scaleY: 1, duration: 0.24, ease: 'expo.out' });
						if (layer) gsap.to(layer, { opacity: 1, duration: 0.3 });
						if (cmd) gsap.fromTo(cmd, { xPercent: -100 }, { xPercent: 0, duration: 0.38, delay: 0.15 });
						if (ok) gsap.to(ok, { opacity: 1, duration: 0.3, delay: 0.7 });
					},
				});
			},
		});

		const steps = gsap.utils.toArray<HTMLElement>('.step');
		ScrollTrigger.create({
			trigger: '#how',
			start: 'top 60%',
			end: 'bottom 40%',
			onUpdate: (self) => {
				const idx = self.progress < 0.33 ? 0 : self.progress < 0.66 ? 1 : 2;
				steps.forEach((step, i) => step.classList.toggle('is-active', i === idx));
				document.querySelector('[data-tab="workflow"]')?.classList.toggle('is-on', idx !== 0);
				document.querySelector('[data-tab="adapter"]')?.classList.toggle('is-on', idx === 0);
				document.querySelector('[data-pane="workflow"]')?.classList.toggle('is-on', idx !== 0);
				document.querySelector('[data-pane="adapter"]')?.classList.toggle('is-on', idx === 0);
			},
		});
	});
}

function initTiles() {
	const mm = gsap.matchMedia();
	mm.add('(min-width: 900px)', () => {
		ScrollTrigger.batch('.tile', {
			once: true,
			start: 'top 85%',
			onEnter: (batch) => {
				gsap.to(batch, {
					opacity: 1,
					y: 0,
					scale: 1,
					duration: 0.6,
					ease: 'expo.out',
					stagger: { each: 0.05, grid: 'auto', from: 'start' },
				});
			},
		});
	});
}

function initPricing() {
	const count = document.querySelector<HTMLElement>('[data-count]');
	if (count && window.matchMedia('(min-width: 900px)').matches) {
		const obj = { n: 0 };
		gsap.to(obj, {
			n: 49,
			duration: 0.6,
			ease: 'power2.out',
			scrollTrigger: { trigger: '#pricing', start: 'top 60%', once: true },
			onUpdate: () => {
				count.textContent = String(Math.round(obj.n));
			},
		});
	}
	const card = document.querySelector('#pricing');
	if (!card) return;
	const io = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) entry.target.classList.toggle('lit', entry.isIntersecting);
		},
		{ threshold: 0.5 },
	);
	io.observe(card);
}

function initSim() {
	const root = document.querySelector<HTMLElement>('#sim');
	if (!root) return;
	root.classList.add('sim-js');
	const rows = Object.fromEntries(
		['created', 'paid', 'refund', 'dispute', 'past_due'].map((key) => [
			key,
			root.querySelector(`[data-sim-jump="${key}"]`),
		]),
	);
	const tl = gsap.timeline({ repeat: -1, paused: true });
	tl.addLabel('created', 0)
		.fromTo(rows.created, { opacity: 0, x: -8 }, { opacity: 1, x: 0, duration: 0.32 }, 0)
		.addLabel('paid', 1.2)
		.fromTo(rows.paid, { opacity: 0, x: -8 }, { opacity: 1, x: 0, duration: 0.32 }, 1.2)
		.to('.plan-trial', { opacity: 0, duration: 0.18 }, 1.2)
		.to('.plan-pro', { opacity: 1, duration: 0.18 }, 1.2)
		.fromTo('.verdict[data-v="paid"]', { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.28 }, 1.35)
		.addLabel('refund', 2.6)
		.fromTo(rows.refund, { opacity: 0, x: -8 }, { opacity: 1, x: 0, duration: 0.32 }, 2.6)
		.to('.row-hl', { opacity: 1, duration: 0.22 }, 2.6)
		.fromTo('.row-sweep', { xPercent: -100, opacity: 1 }, { xPercent: 100, duration: 0.6 }, 2.7)
		.to('.db-leak', { opacity: 1, duration: 0.3 }, 2.6)
		.fromTo('.leak-callout', { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.32 }, 3.4)
		.fromTo('.verdict[data-v="refund"]', { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.28 }, 3.4)
		.addLabel('dispute', 4.2)
		.fromTo(rows.dispute, { opacity: 0, x: -8 }, { opacity: 1, x: 0, duration: 0.32 }, 4.2)
		.to('.db-false', { x: 2, duration: 0.08, yoyo: true, repeat: 5 }, 4.3)
		.addLabel('past_due', 5.4)
		.fromTo(rows.past_due, { opacity: 0, x: -8 }, { opacity: 1, x: 0, duration: 0.32 }, 5.4)
		.fromTo('.verdict[data-v="block"]', { opacity: 0, x: -8 }, { opacity: 1, x: 0, duration: 0.7 }, 5.4)
		.addLabel('reset', 8.4)
		.to('.sim-row, .verdict, .leak-callout', { opacity: 0.35, duration: 0.4 }, 8.4)
		.to('.db-leak, .row-hl, .plan-pro', { opacity: 0, duration: 0.4 }, 8.4)
		.to('.plan-trial', { opacity: 1, duration: 0.4 }, 8.4)
		.set('.sim-row, .verdict, .leak-callout, .db-leak, .row-hl, .plan-pro', { opacity: 0, x: 0 }, 9.4)
		.set('.plan-trial', { opacity: 1 }, 9.4);

	let held = false;
	const replay = root.querySelector<HTMLButtonElement>('.replay');
	root.querySelectorAll<HTMLButtonElement>('[data-sim-jump]').forEach((btn) => {
		btn.addEventListener('click', () => {
			const label = btn.dataset.simJump;
			if (!label) return;
			held = true;
			tl.pause();
			tl.tweenTo(label);
			if (replay) replay.hidden = false;
		});
	});
	replay?.addEventListener('click', () => {
		held = false;
		replay.hidden = true;
		tl.play();
	});
	root.addEventListener('keydown', (event) => {
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
		const list = [...root.querySelectorAll<HTMLButtonElement>('[data-sim-jump]')];
		const current = list.indexOf(document.activeElement as HTMLButtonElement);
		const dir = event.key === 'ArrowDown' ? 1 : -1;
		const next = list[(current + dir + list.length) % list.length];
		next?.focus();
		next?.click();
		event.preventDefault();
	});

	const start = () => {
		if (!held && !root.classList.contains('offscreen')) tl.play();
	};
	window.setTimeout(start, 300);
	document.fonts.ready.then(start);

	const io = new IntersectionObserver((entries) => {
		for (const entry of entries) {
			root.classList.toggle('offscreen', !entry.isIntersecting);
			if (!entry.isIntersecting) tl.pause();
			else if (!held) tl.play();
		}
	});
	io.observe(root);
	document.addEventListener('visibilitychange', () => {
		if (document.hidden) tl.pause();
		else if (!held && !root.classList.contains('offscreen')) tl.play();
	});
}

function initLoops() {
	const nodes = document.querySelectorAll('.hero-field, .chip-track, .dispute-visual, #pricing');
	const io = new IntersectionObserver((entries) => {
		for (const entry of entries) entry.target.classList.toggle('offscreen', !entry.isIntersecting);
	});
	nodes.forEach((node) => io.observe(node));
	document.addEventListener('visibilitychange', () => {
		document.documentElement.classList.toggle('offscreen', document.hidden);
	});
}

function initSpotlight() {
	if (!window.matchMedia('(hover: hover)').matches) return;
	document.querySelectorAll<HTMLElement>('.tile, .price-card').forEach((el) => {
		let frame = 0;
		el.addEventListener('pointermove', (event) => {
			if (frame) return;
			frame = requestAnimationFrame(() => {
				const rect = el.getBoundingClientRect();
				el.style.setProperty('--mx', `${event.clientX - rect.left}px`);
				el.style.setProperty('--my', `${event.clientY - rect.top}px`);
				frame = 0;
			});
		});
	});
}

function initCopy() {
	const button = document.querySelector<HTMLButtonElement>('[data-copy]');
	const code = document.querySelector('[data-pane="workflow"]');
	if (!button || !code) return;
	button.addEventListener('click', async () => {
		const text = code.textContent?.replace(/\s+\n/g, '\n').trim() ?? '';
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			return;
		}
		const mark = button.querySelector<HTMLElement>('.check');
		if (!mark) return;
		gsap.fromTo(mark, { opacity: 0 }, { opacity: 1, duration: 0.12 });
		gsap.to(mark, { opacity: 0, delay: 1.2, duration: 0.2 });
	});
}
