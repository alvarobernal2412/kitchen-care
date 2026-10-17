import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/lib/styles/tokens.css', import.meta.url), 'utf8');

/** Extract `--name: value` declarations from a CSS fragment. */
function declarations(fragment: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const m of fragment.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
	return out;
}

// tokens.css holds the light :root block first, then one dark media block; nothing else.
const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
if (darkStart < 0) throw new Error('tokens.css has no dark block');
const light = declarations(css.slice(0, darkStart));
const darkOverrides = declarations(css.slice(darkStart));
const dark = { ...light, ...darkOverrides };

// Colour tokens that are intentionally identical in both schemes (none today). A colour defined
// in the light block but missing from the dark block must be listed here, otherwise the dark
// theme would silently reuse a light value.
const SAME_IN_BOTH_SCHEMES: string[] = [];
const isHex = (v: string) => /^#[0-9a-f]{6}$/i.test(v);

describe('dark block completeness', () => {
	it('redefines every light colour token (or lists it as intentionally shared)', () => {
		const missing = Object.entries(light)
			.filter(([k, v]) => isHex(v) && !(k in darkOverrides) && !SAME_IN_BOTH_SCHEMES.includes(k))
			.map(([k]) => k);
		expect(missing).toEqual([]);
	});
});

function luminance(hex: string): number {
	const v = /^#([0-9a-f]{6})$/i.exec(hex)?.[1];
	if (!v) throw new Error(`not a 6-digit hex: ${hex}`);
	const [r, g, b] = [0, 2, 4].map((i) => {
		const c = parseInt(v.slice(i, i + 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

// Every text/background pair the shipped CSS (base.css, components.css, Avatar) can produce.
const TEXT: [string, string][] = [
	// body text and muted text on each surface
	['ink', 'ground'],
	['ink', 'surface'],
	['ink', 'recess'], // .btn-quiet hover
	['ink', 'accent-wash'], // highlighted ("you") row
	['ink', 'glaze'],
	['muted', 'ground'],
	['muted', 'surface'], // .help, .input::placeholder
	['muted', 'recess'], // inactive .seg-item
	['muted', 'accent-wash'],
	['muted', 'glaze'],
	// accent text
	['accent', 'ground'],
	['accent', 'surface'],
	['accent-ink', 'ground'], // links
	['accent-ink', 'surface'], // active .seg-item
	['accent-ink', 'recess'],
	['accent-ink', 'accent-wash'], // .chip
	['on-accent', 'accent'], // .btn-primary
	['on-accent', 'accent-hover'],
	['on-accent', 'accent-press'],
	// pending
	['pending-ink', 'pending-wash'], // .chip-pending
	['pending-ink', 'surface'],
	['pending-ink', 'ground'],
	// danger
	['danger', 'ground'], // .error, .btn-danger
	['danger', 'surface'],
	['danger', 'danger-wash'], // .chip-danger, .btn-danger hover
	// heatmap cell counts (step 0 is --recess)
	['ink', 'heat-1'],
	['ink', 'heat-2'],
	['on-accent', 'heat-3'],
	['on-accent', 'heat-4'],
	// camera overlay (the same in both schemes)
	['cam-fg', 'cam-bg'],
	['cam-muted', 'cam-bg'],
	['cam-fg', 'cam-bar'],
	['cam-muted', 'cam-bar'],
	['cam-on-accent', 'cam-accent'], // "Use photo"
	['cam-accent', 'cam-bg'],
	['cam-warn-fg', 'cam-warn-bg'], // detection banner
	['cam-error-fg', 'cam-error-bg'], // permission errors
	['cam-focus', 'cam-bar'],
	...[1, 2, 3, 4, 5, 6].map((n): [string, string] => [`avatar-${n}-fg`, `avatar-${n}-bg`])
];
// Focus ring, active indicator and invalid-field border are non-text.
const NON_TEXT: [string, string][] = [
	['accent', 'ground'],
	['accent', 'surface'],
	['danger', 'ground'],
	['danger', 'surface'],
	// chart marks against the surface they are drawn on
	['chart-1', 'surface'],
	['chart-2', 'surface'],
	['chart-1', 'ground'],
	['chart-2', 'ground'],
	// camera focus ring and shutter on the dark overlay
	['cam-focus', 'cam-bg'],
	['cam-fg', 'cam-bg']
];

describe.each([
	['light', light],
	['dark', dark]
])('token contrast (%s)', (_name, t) => {
	it.each(TEXT)('%s on %s is at least 4.5:1', (fg, bg) => {
		expect(t[fg], `--${fg}`).toBeDefined();
		expect(t[bg], `--${bg}`).toBeDefined();
		expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
	});
	it.each(NON_TEXT)('focus ring / indicator %s on %s is at least 3:1', (fg, bg) => {
		expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(3);
	});
});
