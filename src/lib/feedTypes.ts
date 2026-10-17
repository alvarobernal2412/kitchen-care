import type { Emoji } from './emoji';

export type FeedAuthor = {
	id: number;
	username: string;
	avatar: string | null;
	department: string | null;
	classification: string | null;
	deactivated: boolean;
};

/** Wire shape of a post (dates as ISO strings). */
export type FeedPost = {
	id: number;
	createdAt: string;
	title: string;
	body: string;
	imagePath: string | null;
	milestone: { taskLabel: string } | null;
	author: FeedAuthor;
	reactions: Record<Emoji, number>;
	mine: Emoji[];
	commentCount: number;
};

export type FeedComment = {
	id: number;
	postId: number;
	createdAt: string;
	body: string;
	author: FeedAuthor;
};
