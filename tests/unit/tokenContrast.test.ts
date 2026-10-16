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
const dark = { ...light, ...declarations(css.slice(darkStart)) };

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

const TEXT: [string, string][] = [
	['ink', 'ground'],
	['ink', 'surface'],
	['muted', 'ground'],
	['muted', 'surface'],
	['accent', 'ground'],
	['accent', 'surface'],
	['accent-ink', 'accent-wash'],
	['pending-ink', 'pending-wash'],
	['danger', 'danger-wash'],
	['on-accent', 'accent'],
	['on-accent', 'accent-hover'],
	['on-accent', 'accent-press'],
	['ink', 'recess'],
	['accent-ink', 'surface'],
	...[1, 2, 3, 4, 5, 6].map((n): [string, string] => [`avatar-${n}-fg`, `avatar-${n}-bg`])
];
const NON_TEXT: [string, string][] = [
	['accent', 'ground'],
	['accent', 'surface']
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
