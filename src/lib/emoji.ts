export const EMOJIS = ['👏', '❤️', '☕', '🎉', '🙌'] as const;
export type Emoji = (typeof EMOJIS)[number];

export function isEmoji(value: unknown): value is Emoji {
	return typeof value === 'string' && (EMOJIS as readonly string[]).includes(value);
}
