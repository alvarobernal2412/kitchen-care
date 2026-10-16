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
