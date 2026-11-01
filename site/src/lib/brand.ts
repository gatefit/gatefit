// GATEFIT-H27 brand palette. One source for the dial, the asset script, and the
// contrast test; the CSS tokens in styles/*.css repeat these values verbatim.
export const BRAND = {
	navy: '#0B1B3A',
	navyDeep: '#071330',
	surface: '#10234A',
	surface2: '#163060',
	text: '#F4F7FB',
	body: '#D3DCEB',
	muted: '#9AA8C2',
	faint: '#8794AE',
	mint: '#5EE0A8',
	mintHigh: '#A8F0CF',
	mintLow: '#123F3A',
	red: '#F2555A',
} as const;

/** Open/pass state. Merged into the brand mint (H27); red stays locked/fail. */
export const OPEN = BRAND.mint;
export const LOCKED = BRAND.red;
