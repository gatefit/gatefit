// GATEFIT-H30 /status page. Pure view model (tested in status-site.test.ts) plus the DOM
// glue in start(). Every fetch failure, non-200, bad JSON, or schema mismatch renders
// unknown; nothing is stored in the browser and API strings only reach textContent.

export const STATUS_URL = 'https://t.gatefit.io/v1/status';
export const STATS_URL = 'https://t.gatefit.io/v1/stats';
/** checked_at older than this means the probes stopped: everything is unknown. */
export const FRESH_MS = 15 * 60_000;
const DAYS = 90;
const DAY_MS = 86_400_000;

const IDS = ['site', 'npm', 'telemetry', 'action', 'polar'] as const;
type Id = (typeof IDS)[number];
type State = 'ok' | 'deg' | 'down' | 'unknown';
type DayState = 'ok' | 'deg' | 'down' | 'none';
const STATES: readonly string[] = ['ok', 'deg', 'down', 'unknown'];
const DAY_STATES: readonly string[] = ['ok', 'deg', 'down', 'none'];
const PACKS: readonly string[] = ['chaos', 'polar', 'paddle'];
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const SERVICES: ReadonlyArray<{ id: Id; name: string; detail: (version?: string) => string }> = [
	{ id: 'site', name: 'gatefit.io', detail: () => 'landing + docs' },
	{ id: 'npm', name: 'npm gatefit', detail: (v) => (v ? `gatefit@${v}` : '—') },
	{ id: 'telemetry', name: 't.gatefit.io', detail: () => 'usage collector' },
	{ id: 'action', name: 'GitHub Action', detail: (v) => (v ? `gatefit/gatefit@v${v}` : '—') },
	{ id: 'polar', name: 'Polar checkout', detail: () => 'Buy link · $49 license' },
];

const LABEL: Record<State, string> = { ok: 'Operational', deg: 'Degraded', down: 'Down', unknown: 'Unknown' };

export type StatusPayload = {
	checked_at: string | null;
	services: Array<{ id: Id; state: State; version?: string; days: Array<{ day: string; up_pct: number | null; state: DayState }> }>;
};

export type CountRow = { day: string; kind: string; command: string; pack: string; event: string; n: number };
export type StatsPayload = { counts: CountRow[] };

function isObject(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Strict: any unexpected shape returns null, which renders unknown. */
export function parseStatus(v: unknown): StatusPayload | null {
	if (!isObject(v) || !Array.isArray(v.services)) return null;
	const checked = v.checked_at;
	if (checked !== null && (typeof checked !== 'string' || Number.isNaN(Date.parse(checked)))) return null;
	const services: StatusPayload['services'] = [];
	for (const s of v.services) {
		if (!isObject(s) || !IDS.includes(s.id as Id) || typeof s.state !== 'string' || !STATES.includes(s.state)) return null;
		if (s.version !== undefined && (typeof s.version !== 'string' || !SEMVER.test(s.version))) return null;
		if (!Array.isArray(s.days) || s.days.length !== DAYS) return null;
		const days: StatusPayload['services'][number]['days'] = [];
		for (const d of s.days) {
			if (!isObject(d) || typeof d.day !== 'string' || !DAY_RE.test(d.day)) return null;
			if (typeof d.state !== 'string' || !DAY_STATES.includes(d.state)) return null;
			if (d.up_pct !== null && (typeof d.up_pct !== 'number' || !(d.up_pct >= 0 && d.up_pct <= 100))) return null;
			days.push({ day: d.day, up_pct: d.up_pct as number | null, state: d.state as DayState });
		}
		services.push({ id: s.id as Id, state: s.state as State, version: s.version as string | undefined, days });
	}
	return { checked_at: checked as string | null, services };
}

export function parseStats(v: unknown): StatsPayload | null {
	if (!isObject(v) || !Array.isArray(v.counts)) return null;
	const counts: CountRow[] = [];
	for (const c of v.counts) {
		if (!isObject(c) || typeof c.day !== 'string' || !DAY_RE.test(c.day)) return null;
		if (typeof c.n !== 'number' || !Number.isInteger(c.n) || c.n < 0) return null;
		const str = (k: string) => (typeof c[k] === 'string' ? (c[k] as string) : null);
		const [kind, command, pack, event] = [str('kind'), str('command'), str('pack'), str('event')];
		if (kind === null || command === null || pack === null || event === null) return null;
		counts.push({ day: c.day, kind, command, pack, event, n: c.n });
	}
	return { counts };
}

async function loadJson<T>(fetchFn: typeof fetch, url: string, parse: (v: unknown) => T | null, timeoutMs = 5000): Promise<T | null> {
	try {
		const res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs), mode: 'cors' });
		if (res.status !== 200) return null;
		return parse(JSON.parse(await res.text()));
	} catch {
		return null;
	}
}

export function loadStatus(fetchFn: typeof fetch = fetch): Promise<StatusPayload | null> {
	return loadJson(fetchFn, STATUS_URL, parseStatus);
}

export function loadStats(fetchFn: typeof fetch = fetch, days = 30): Promise<StatsPayload | null> {
	return loadJson(fetchFn, `${STATS_URL}?days=${days}`, parseStats);
}

export type ServiceView = {
	id: Id;
	name: string;
	detail: string;
	state: State;
	label: string;
	uptime: string;
	ticks: Array<{ state: DayState; title: string }>;
};

export type StatusView = {
	banner: { state: State; text: string };
	checkedAt: string | null;
	services: ServiceView[];
};

function emptyTicks(): ServiceView['ticks'] {
	return Array.from({ length: DAYS }, () => ({ state: 'none' as const, title: 'no data' }));
}

export function statusView(payload: StatusPayload | null, now: Date): StatusView {
	const fresh = !!payload?.checked_at && now.getTime() - Date.parse(payload.checked_at) <= FRESH_MS;
	const byId = new Map((fresh ? payload!.services : []).map((s) => [s.id, s]));
	const services = SERVICES.map((meta): ServiceView => {
		const s = byId.get(meta.id);
		const state: State = s?.state ?? 'unknown';
		const known = s?.days.filter((d) => d.state !== 'none' && d.up_pct !== null) ?? [];
		const uptime = known.length ? (known.reduce((a, d) => a + (d.up_pct ?? 0), 0) / known.length).toFixed(2) : '—';
		return {
			id: meta.id,
			name: meta.name,
			detail: meta.detail(s?.version),
			state,
			label: LABEL[state],
			uptime,
			ticks: s
				? s.days.map((d) => ({ state: d.state, title: d.up_pct === null ? `${d.day}: no data` : `${d.day}: ${d.up_pct}% up` }))
				: emptyTicks(),
		};
	});
	const names = (st: State) => services.filter((s) => s.state === st).map((s) => s.name).join(', ');
	let banner: StatusView['banner'];
	if (services.some((s) => s.state === 'down')) {
		const deg = names('deg');
		banner = { state: 'down', text: `Partial outage: ${names('down')}${deg ? `. Degraded: ${deg}` : ''}` };
	} else if (services.some((s) => s.state === 'deg')) {
		banner = { state: 'deg', text: `Degraded performance: ${names('deg')}` };
	} else if (services.every((s) => s.state === 'unknown')) {
		banner = { state: 'unknown', text: 'Status unknown' };
	} else if (services.some((s) => s.state === 'unknown')) {
		banner = { state: 'unknown', text: 'Status partly unknown' };
	} else {
		banner = { state: 'ok', text: 'All systems operational' };
	}
	return { banner, checkedAt: fresh ? payload!.checked_at : null, services };
}

export type UsageView = {
	available: boolean;
	note: string;
	from: string;
	to: string;
	cards: Array<{ k: string; v: string; s: string }>;
	bars: Array<{ day: string; run: number; init: number; buy: number }>;
};

export function usageView(stats: StatsPayload | null, days: number, today: string): UsageView {
	const end = Date.parse(`${today}T00:00:00Z`);
	const list: string[] = [];
	for (let k = days - 1; k >= 0; k--) list.push(new Date(end - k * DAY_MS).toISOString().slice(0, 10));
	const per = new Map(list.map((d) => [d, { day: d, run: 0, init: 0, buy: 0 }]));
	const packs = new Set<string>();
	for (const c of stats?.counts ?? []) {
		const p = per.get(c.day);
		if (!p) continue;
		if (c.kind === 'cli' && c.command === 'run') p.run += c.n;
		else if (c.kind === 'cli' && c.command === 'init') p.init += c.n;
		else if (c.kind === 'site' && c.event === 'buy_click') p.buy += c.n;
		if (c.kind === 'cli' && PACKS.includes(c.pack) && c.n > 0) packs.add(c.pack);
	}
	const bars = [...per.values()];
	const sum = (k: 'run' | 'init' | 'buy') => (stats ? String(bars.reduce((a, b) => a + b[k], 0)) : '—');
	return {
		available: !!stats,
		note: stats ? `Events per day · last ${days} days` : 'Usage unavailable',
		from: list[0]!,
		to: list[list.length - 1]!,
		cards: [
			{ k: 'gatefit run', v: sum('run'), s: 'CLI runs' },
			{ k: 'gatefit init', v: sum('init'), s: 'projects set up' },
			{ k: 'Buy clicks', v: sum('buy'), s: 'site → Polar' },
			{ k: 'Provider packs', v: stats ? String(packs.size) : '—', s: 'distinct packs run' },
		],
		bars: stats ? bars : [],
	};
}

// DOM glue below. Builds nodes with createElement/textContent only.

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (cls) node.className = cls;
	if (text !== undefined) node.textContent = text;
	return node;
}

function renderStatus(view: StatusView): void {
	const banner = document.getElementById('banner');
	const dot = banner?.querySelector('.dot');
	if (banner) banner.className = `banner ${view.banner.state}`;
	if (dot) dot.className = `dot ${view.banner.state}`;
	const text = document.getElementById('banner-text');
	if (text) text.textContent = view.banner.text;
	const checked = document.getElementById('checked');
	if (checked) {
		checked.textContent = view.checkedAt
			? `Last checked ${new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(new Date(view.checkedAt))}`
			: 'Last checked: unknown';
	}
	const list = document.getElementById('svc');
	if (!list) return;
	const rows = view.services.map((s) => {
		const row = el('div', 'row');
		row.dataset.service = s.id;
		const head = el('div', 'rh');
		head.append(el('span', `dot ${s.state}`), el('span', 'name', s.name), el('span', 'detail', s.detail), el('span', `state ${s.state}`, s.label));
		const ticks = el('div', 'ticks');
		ticks.setAttribute('aria-hidden', 'true');
		for (const t of s.ticks) {
			const i = el('i', t.state);
			i.title = t.title;
			ticks.append(i);
		}
		const foot = el('div', 'tf num');
		foot.append(el('span', undefined, '90 days ago'), el('span', 'pct', s.uptime === '—' ? 'uptime —' : `${s.uptime}% uptime`), el('span', undefined, 'today'));
		row.append(head, ticks, foot);
		return row;
	});
	list.replaceChildren(...rows);
}

function renderUsage(view: UsageView, days: number): void {
	const cards = document.getElementById('cards');
	cards?.replaceChildren(
		...view.cards.map((c) => {
			const card = el('div', 'card');
			card.append(el('div', 'k', c.k), el('div', 'v num', c.v), el('div', 's', c.s));
			return card;
		}),
	);
	const title = document.getElementById('chart-title');
	if (title) title.textContent = view.note;
	const bars = document.getElementById('bars');
	if (bars) {
		bars.classList.toggle('dense', days > 30);
		const max = Math.max(1, ...view.bars.map((b) => b.run + b.init + b.buy));
		bars.replaceChildren(
			...view.bars.map((b) => {
				const total = b.run + b.init + b.buy;
				const bar = el('div', 'bar');
				bar.title = `${b.day}: ${b.run} runs, ${b.init} init, ${b.buy} buy clicks`;
				if (!total) {
					bar.append(el('span', 'base'));
					return bar;
				}
				for (const [k, n] of [['run', b.run], ['init', b.init], ['buy', b.buy]] as const) {
					const seg = el('b', `seg-${k}`);
					seg.style.height = `${(n / max) * 100}%`;
					bar.append(seg);
				}
				const lbl = el('span', 'lbl', String(total));
				lbl.style.bottom = `calc(${(total / max) * 100}% + 4px)`;
				bar.append(lbl);
				return bar;
			}),
		);
	}
	const ax0 = document.getElementById('ax0');
	const ax1 = document.getElementById('ax1');
	if (ax0) ax0.textContent = view.available ? view.from : '';
	if (ax1) ax1.textContent = view.available ? view.to : '';
	document.querySelectorAll<HTMLButtonElement>('.seg button').forEach((b) => {
		b.setAttribute('aria-pressed', b.dataset.d === String(days) ? 'true' : 'false');
	});
}

function setupNav(): void {
	const nav = document.querySelector<HTMLElement>('.site-nav');
	const toggle = nav?.querySelector<HTMLButtonElement>('.nav-toggle');
	const setOpen = (open: boolean) => {
		nav?.classList.toggle('is-open', open);
		document.documentElement.classList.toggle('nav-open', open);
		toggle?.setAttribute('aria-expanded', open ? 'true' : 'false');
	};
	toggle?.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
	document.addEventListener('keydown', (event) => {
		if (event.key !== 'Escape' || !nav?.classList.contains('is-open')) return;
		setOpen(false);
		toggle?.focus({ preventScroll: true });
	});
}

export function start(): void {
	setupNav();
	void loadStatus().then((payload) => renderStatus(statusView(payload, new Date())));
	// The last good response per range is kept in memory only.
	const cache = new Map<number, StatsPayload>();
	let current = 30;
	const show = async (days: number) => {
		current = days;
		const today = new Date().toISOString().slice(0, 10);
		const stats = cache.get(days) ?? (await loadStats(fetch, days));
		if (stats) cache.set(days, stats);
		if (current === days) renderUsage(usageView(stats, days, today), days);
	};
	document.querySelectorAll<HTMLButtonElement>('.seg button').forEach((b) => {
		b.addEventListener('click', () => void show(Number(b.dataset.d)));
	});
	void show(current);
}
