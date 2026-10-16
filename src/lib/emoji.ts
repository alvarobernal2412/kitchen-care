export const EMOJIS = ['👏', '❤️', '☕', '🎉', '🙌'] as const;
export type Emoji = (typeof EMOJIS)[number];

export const EMOJI_NAMES: Record<Emoji, string> = {
	'👏': 'Clap',
	'❤️': 'Love',
	'☕': 'Coffee',
	'🎉': 'Celebrate',
	'🙌': 'Praise'
};

/** Accessible name for a reaction button, e.g. "Clap, 3 reactions". */
export function reactionLabel(emoji: Emoji, count: number): string {
	return `${EMOJI_NAMES[emoji]}, ${count} ${count === 1 ? 'reaction' : 'reactions'}`;
}

export function isEmoji(value: unknown): value is Emoji {
	return typeof value === 'string' && (EMOJIS as readonly string[]).includes(value);
}
