// C0/C1 controls except tab (09) and newline (0A); CR is normalised before this runs.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
// Zero-width space, LRM/RLM, bidi embeddings/overrides/isolates, word joiner & invisible
// operators, soft hyphen, BOM. ZWJ/ZWNJ (200C/200D) are kept: emoji sequences need them.
const INVISIBLE = /[\u00AD\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/**
 * Normalises user text for storage. Deliberately does NOT HTML-encode: Svelte escapes on
 * render, and no `{@html}` is used for user content, so markup is displayed as plain text.
 */
export function sanitizeText(s: string): string {
	return s
		.replace(/\r\n?/g, '\n')
		.replace(CONTROL, '')
		.replace(INVISIBLE, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}
