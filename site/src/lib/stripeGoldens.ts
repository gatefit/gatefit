// Stripe transition inventory for the landing page. The YAML directory is the
// count; the README pack column says which set each file belongs to. A new
// golden shows up here without a hardcoded total.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type StripeGolden = { id: string; pack: string; n: number };

const ROW = /^\| `([a-z0-9_]+)` \| ((?:S|H)\d+) \|/;

function repoRoot(): string {
	const fromFile = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
	if (existsSync(path.join(fromFile, 'tests/entitlements/goldens'))) return fromFile;
	const fromSite = path.resolve(process.cwd(), '..');
	if (existsSync(path.join(fromSite, 'tests/entitlements/goldens'))) return fromSite;
	throw new Error('tests/entitlements/goldens not found from the site build');
}

export function loadStripeGoldens(): StripeGolden[] {
	const dir = path.join(repoRoot(), 'tests/entitlements/goldens');
	const files = new Set(
		readdirSync(dir)
			.filter((name) => name.endsWith('.yaml'))
			.map((name) => name.slice(0, -'.yaml'.length)),
	);
	const listed: StripeGolden[] = [];
	for (const line of readFileSync(path.join(dir, 'README.md'), 'utf8').split('\n')) {
		const match = ROW.exec(line);
		if (!match) continue;
		const id = match[1];
		const pack = match[2];
		if (!files.has(id)) throw new Error(`README lists ${id} but ${id}.yaml is missing`);
		files.delete(id);
		listed.push({ id, pack, n: Number(pack.slice(1)) });
	}
	if (files.size > 0) throw new Error(`goldens missing a README pack row: ${[...files].join(', ')}`);
	return listed;
}

function orderIds(items: StripeGolden[], preferred: readonly string[]): string[] {
	const ids = new Set(items.map((item) => item.id));
	const known = preferred.filter((id) => ids.has(id));
	const extra = items
		.filter((item) => !preferred.includes(item.id))
		.sort((a, b) => a.n - b.n || a.id.localeCompare(b.id))
		.map((item) => item.id);
	return [...known, ...extra];
}

function rangeLabel(items: StripeGolden[], prefix: string): string {
	const nums = items.map((item) => item.n).sort((a, b) => a - b);
	if (nums.length === 0) return prefix;
	return `${prefix}${nums[0]}–${prefix}${nums[nums.length - 1]}`;
}

/** Landing groups. `preferred*` keeps the phase A tag order; newer ids append by pack number. */
export function landingSets(goldens: StripeGolden[], preferredFree: readonly string[], preferredPhase2: readonly string[]) {
	const free = goldens.filter((item) => item.pack.startsWith('S'));
	const phase2 = goldens.filter((item) => item.pack.startsWith('H'));
	const other = goldens.filter((item) => !item.pack.startsWith('S') && !item.pack.startsWith('H'));
	if (other.length > 0) throw new Error(`unclassified goldens: ${other.map((item) => item.id).join(', ')}`);
	const freeIds = orderIds(free, preferredFree);
	const phase2Ids = orderIds(phase2, preferredPhase2);
	return {
		total: goldens.length,
		free: freeIds,
		phase2: phase2Ids,
		sLabel: rangeLabel(free, 'S'),
	};
}
