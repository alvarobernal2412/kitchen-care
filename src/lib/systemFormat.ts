/** Display helpers for the admin System page. Pure; safe on server and client. */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** 1023 -> "1023 B", 1024 -> "1.0 KB". Negative -> "0 B", not a finite number -> "n/a". */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes)) return 'n/a';
	if (bytes <= 0) return '0 B';
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < UNITS.length - 1) {
		value /= 1024;
		unit++;
	}
	return unit === 0 ? `${Math.round(value)} B` : `${value.toFixed(1)} ${UNITS[unit]}`;
}

/** Whole percent, one decimal below 10 (trailing ".0" dropped). Negative -> "0%". */
export function formatPercent(percent: number): string {
	if (!Number.isFinite(percent)) return 'n/a';
	const p = Math.max(0, percent);
	return p < 10 ? `${Number(p.toFixed(1))}%` : `${Math.round(p)}%`;
}

/** Seconds as "45 s", "5 min", "3 h 5 min", "2 d 4 h". */
export function formatDuration(seconds: number): string {
	if (!Number.isFinite(seconds)) return 'n/a';
	const s = Math.max(0, Math.floor(seconds));
	if (s < 60) return `${s} s`;
	const min = Math.floor(s / 60);
	if (min < 60) return `${min} min`;
	const h = Math.floor(min / 60);
	if (h < 24) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
	const d = Math.floor(h / 24);
	return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

/** Milliseconds as "12 ms" or "1.2 s". */
export function formatMs(ms: number): string {
	if (!Number.isFinite(ms)) return 'n/a';
	const v = Math.max(0, ms);
	return v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(1)} s`;
}
