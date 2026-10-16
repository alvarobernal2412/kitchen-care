/** Compact label for activity rows: "now", "12 min", "1 h", "3 d". */
export function shortAgo(iso: string, now: number = Date.now()): string {
	const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
	if (s < 60) return 'now';
	const m = Math.floor(s / 60);
	if (m < 60) return `${m} min`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h} h`;
	return `${Math.floor(h / 24)} d`;
}

/** "just now", "5m ago", "2h ago", "3d ago", then a short date. */
export function timeAgo(iso: string, now: number = Date.now()): string {
	const then = new Date(iso).getTime();
	const s = Math.max(0, Math.floor((now - then) / 1000));
	if (s < 60) return 'just now';
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.floor(h / 24);
	if (d < 30) return `${d}d ago`;
	return new Date(then).toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric'
	});
}
