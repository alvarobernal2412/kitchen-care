export const EMOJIS = ['👏', '❤️', '☕', '🎉', '🙌'] as const;
export type Emoji = (typeof EMOJIS)[number];

export const EMOJI_NAMES: Record<Emoji, string> = {
	'👏': 'Clap',
	'❤️': 'Love',
	'☕': 'Coffee',
	'🎉': 'Celebrate',
	'🙌': 'Praise'
};

/** Accessible name for a reaction button, e.g. "Clap, 3 reactions" or "Clap, no reactions". */
export function reactionLabel(emoji: Emoji, count: number): string {
	if (count <= 0) return `${EMOJI_NAMES[emoji]}, no reactions`;
	return `${EMOJI_NAMES[emoji]}, ${count} ${count === 1 ? 'reaction' : 'reactions'}`;
}

export function isEmoji(value: unknown): value is Emoji {
	return typeof value === 'string' && (EMOJIS as readonly string[]).includes(value);
}
