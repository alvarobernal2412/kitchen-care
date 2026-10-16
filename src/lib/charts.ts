/** Pure scaling helpers shared by the chart components. */

/** Number of colour steps in the heatmap scale, including step 0 (no activity). */
export const HEAT_STEPS = 5;

/**
 * Maps a count to a heatmap step 0..HEAT_STEPS-1. 0 only for a zero count; any positive
 * count gets at least step 1 so it stays distinguishable from empty; the max gets the top step.
 */
export function intensityStep(count: number, max: number, steps = HEAT_STEPS): number {
	if (!(count > 0) || !(max > 0)) return 0;
	const top = steps - 1;
	return Math.min(top, Math.max(1, Math.ceil((count / max) * top)));
}

/** Pixel height of a bar; positive values are at least 1px tall, 0 stays 0. */
export function barHeight(value: number, axisMax: number, chartHeight: number): number {
	if (!(value > 0) || !(axisMax > 0)) return 0;
	return Math.max(1, Math.round((Math.min(value, axisMax) / axisMax) * chartHeight));
}

/** Rounds a maximum up to 1, 2, 5 or 10 times a power of ten (min 1) for a tidy axis. */
export function niceMax(max: number): number {
	if (!(max > 1)) return 1;
	const pow = 10 ** Math.floor(Math.log10(max));
	for (const m of [1, 2, 5, 10]) if (max <= m * pow) return m * pow;
	return 10 * pow;
}

const numberFormat = new Intl.NumberFormat('en-US');
/** Consistent thousands-separated integer formatting, e.g. 1,234. */
export function formatCount(n: number): string {
	return numberFormat.format(n);
}

/** Largest value in a matrix (0 when empty). */
export function matrixMax(matrix: number[][]): number {
	let max = 0;
	for (const row of matrix) for (const v of row) if (v > max) max = v;
	return max;
}

/** True when every value in the matrix is zero. */
export function isAllZero(matrix: number[][]): boolean {
	return matrixMax(matrix) === 0;
}
