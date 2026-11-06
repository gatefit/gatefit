// Plain-language labels for the Stripe goldens on the landing page.
// Keyed by golden id. A file with no row here fails the label test and the
// site build. The count still comes from the YAML directory, not from this map.
import type { StripeGolden } from './stripeGoldens.ts';

export const OUTCOMES = {
	kept: { pill: 'Access kept', icon: 'check' },
	revoked: { pill: 'Access revoked', icon: 'x' },
	locked: { pill: 'Locked', icon: 'lock' },
	unchanged: { pill: 'No change', icon: 'minus' },
} as const;

export type GoldenOutcome = keyof typeof OUTCOMES;

export const CATEGORIES = [
	{ id: 'payments', title: 'Payments and refunds', icon: 'currency-dollar' },
	{ id: 'trials', title: 'Trials', icon: 'hourglass' },
	{ id: 'changes', title: 'Subscription changes', icon: 'arrows-left-right' },
	{ id: 'pauses', title: 'Pauses and retries', icon: 'pause' },
] as const;

export type GoldenCategory = (typeof CATEGORIES)[number]['id'];

export type GoldenCopy = {
	label: string;
	outcome: GoldenOutcome;
	category: GoldenCategory;
	/** One short line when the pill is not the whole assertion. */
	detail?: string;
};

// Order inside a category is the order these keys are written.
export const GOLDEN_LABELS: Record<string, GoldenCopy> = {
	paid_grants_access: {
		label: 'Paid invoice unlocks',
		outcome: 'kept',
		category: 'payments',
	},
	refund_revokes_access: {
		label: 'Refund → access revoked',
		outcome: 'revoked',
		category: 'payments',
	},
	dispute_revokes_or_flags: {
		label: 'Dispute → locked',
		outcome: 'locked',
		category: 'payments',
		detail: 'Features clear. Plan and seats stay.',
	},
	duplicate_webhook_idempotent: {
		label: 'Duplicate event ignored',
		outcome: 'unchanged',
		category: 'payments',
		detail: 'Sending it again does not grant or revoke.',
	},
	trial_to_paid_grants: {
		label: 'Trial payment unlocks',
		outcome: 'kept',
		category: 'trials',
		detail: 'Trialing stays locked until then.',
	},
	trial_no_card: {
		label: 'Paid after no card',
		outcome: 'kept',
		category: 'trials',
		detail: 'The trial stays locked until a payment. The trial warning never changes access.',
	},
	trial_end_pause_resume_waits_for_paid: {
		label: 'Paid after the pause',
		outcome: 'kept',
		category: 'trials',
		detail: 'Pause and a failed resume stay locked. Resuming does not grant or revoke.',
	},
	cancel_revokes_access: {
		label: 'Cancel → access revoked',
		outcome: 'revoked',
		category: 'changes',
		detail: 'It locks as soon as the subscription is deleted.',
	},
	cancel_at_period_end_keeps_access_until_end: {
		label: 'Locks at period end',
		outcome: 'locked',
		category: 'changes',
		detail: 'Stays open until now reaches the end.',
	},
	portal_downgrade_period_end_vs_immediate: {
		label: 'Downgrade keeps access',
		outcome: 'kept',
		category: 'changes',
		detail: 'Scheduled waits for the period to end. Immediate changes the plan now.',
	},
	upgrade_plus_cape_race: {
		label: 'Upgrade, then period end',
		outcome: 'locked',
		category: 'changes',
		detail: 'Plan and seats change while access stays open.',
	},
	seat_qty_vs_db_cap: {
		label: 'Seat count updates',
		outcome: 'kept',
		category: 'changes',
		detail: 'The new quantity replaces the stored seat count.',
	},
	entitlements_active_summary: {
		label: 'Summary sets features',
		outcome: 'unchanged',
		category: 'changes',
		detail: 'It does not lock or unlock. Unpaid stays locked.',
	},
	past_due_denies_until_recovery: {
		label: 'Past due recovers',
		outcome: 'kept',
		category: 'pauses',
		detail: 'A failed payment locks it until a later one is paid.',
	},
	unpaid_after_retries_revokes: {
		label: 'Unpaid stays locked',
		outcome: 'locked',
		category: 'pauses',
		detail: 'From the failed payment through cancel.',
	},
	smart_retries_unpaid_then_paid_recovers: {
		label: 'Latest invoice recovers',
		outcome: 'kept',
		category: 'pauses',
		detail: 'Failed retries lock it until that invoice is paid. A repeated failure does not lock it again.',
	},
	pause_collection_keeps_access_all_behaviors: {
		label: 'Pause keeps access',
		outcome: 'kept',
		category: 'pauses',
		detail: 'Pausing does not revoke or grant. An uncollectible invoice with no pause locks.',
	},
};

/** Words in a label. The arrow and surrounding punctuation are not words. */
export function labelWordCount(label: string): number {
	return label
		.split(/\s+/)
		.map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
		.filter((word) => word.length > 0).length;
}

export type LandingGolden = StripeGolden &
	GoldenCopy & { pill: string; icon: (typeof OUTCOMES)[GoldenOutcome]['icon'] };

export function groupStripeGoldens(goldens: StripeGolden[]) {
	const ids = new Set(goldens.map((item) => item.id));
	const labeled = Object.keys(GOLDEN_LABELS);
	const missing = [...ids].filter((id) => !GOLDEN_LABELS[id]);
	const extra = labeled.filter((id) => !ids.has(id));
	if (missing.length > 0) throw new Error(`goldens missing a label: ${missing.join(', ')}`);
	if (extra.length > 0) throw new Error(`labels without a golden: ${extra.join(', ')}`);
	const known = new Set<string>(CATEGORIES.map((category) => category.id));
	for (const id of labeled) {
		const category = GOLDEN_LABELS[id].category;
		if (!known.has(category)) throw new Error(`${id} has unknown category ${category}`);
	}
	const byId = new Map(goldens.map((item) => [item.id, item]));
	const categories = CATEGORIES.map((category) => {
		const items: LandingGolden[] = labeled
			.filter((id) => GOLDEN_LABELS[id].category === category.id)
			.map((id) => {
				const copy = GOLDEN_LABELS[id];
				const outcome = OUTCOMES[copy.outcome];
				return { ...byId.get(id)!, ...copy, pill: outcome.pill, icon: outcome.icon };
			});
		if (items.length === 0) throw new Error(`category ${category.id} has no goldens`);
		return { ...category, items };
	});
	const shown = categories.reduce((sum, category) => sum + category.items.length, 0);
	if (shown !== goldens.length) throw new Error(`grouped ${shown} goldens, directory has ${goldens.length}`);
	return { total: goldens.length, categories };
}
