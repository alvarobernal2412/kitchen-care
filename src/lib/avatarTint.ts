const PALETTE_SIZE = 6;

/** FNV-1a over UTF-16 code units; stable across runs and platforms. */
function hash(input: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		h ^= input.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/**
 * Deterministic avatar colours for a seed (user id or name). Returns CSS variable references
 * (defined for light and dark in styles/tokens.css) so dark mode needs no JavaScript.
 */
export function avatarTint(seed: number | string): { bg: string; fg: string } {
	const n = (hash(String(seed)) % PALETTE_SIZE) + 1;
	return { bg: `var(--avatar-${n}-bg)`, fg: `var(--avatar-${n}-fg)` };
}
