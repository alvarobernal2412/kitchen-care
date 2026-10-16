/** "2h 14m", "14m", or "45s" for a remaining wait. Rounds up to the next minute above 1 min. */
export function formatRemaining(seconds: number): string {
	if (seconds < 60) return `${Math.max(1, Math.ceil(seconds))}s`;
	const totalMin = Math.ceil(seconds / 60);
	const h = Math.floor(totalMin / 60);
	const m = totalMin % 60;
	if (h === 0) return `${m}m`;
	return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
