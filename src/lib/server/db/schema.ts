import { sql } from 'drizzle-orm';
import {
	boolean,
	check,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	primaryKey
} from 'drizzle-orm/pg-core';

export const DEPARTMENTS = [
	'Software Systems Programming and Development',
	'Interactions Research Group'
] as const;

const id = () => integer('id').primaryKey().generatedAlwaysAsIdentity();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable(
	'users',
	{
		id: id(),
		usernameNormalized: text('username_normalized').notNull(),
		displayUsername: text('display_username').notNull(),
		passwordHash: text('password_hash').notNull(),
		role: text('role', { enum: ['user', 'admin'] })
			.notNull()
			.default('user'),
		classification: text('classification', { enum: ['Student', 'Employee'] }),
		department: text('department', { enum: DEPARTMENTS }),
		avatarPath: text('avatar_path'),
		active: boolean('active').notNull().default(true),
		onboardingCompleted: boolean('onboarding_completed').notNull().default(false),
		createdAt: createdAt()
	},
	(t) => [
		uniqueIndex('users_username_normalized_idx').on(t.usernameNormalized),
		check(
			'users_classification_check',
			sql`${t.classification} in ('Student', 'Employee')`
		),
		check(
			'users_department_check',
			sql`${t.department} in ('Software Systems Programming and Development', 'Interactions Research Group')`
		)
	]
);

export const sessions = pgTable(
	'sessions',
	{
		id: text('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		createdAt: createdAt()
	},
	(t) => [index('sessions_user_idx').on(t.userId)]
);

export const resetTokens = pgTable('reset_tokens', {
	tokenHash: text('token_hash').primaryKey(),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	usedAt: timestamp('used_at', { withTimezone: true })
});

export const periods = pgTable(
	'periods',
	{
		id: id(),
		name: text('name').notNull(),
		startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
		endsAt: timestamp('ends_at', { withTimezone: true }),
		status: text('status', { enum: ['active', 'ended'] })
			.notNull()
			.default('active')
	},
	(t) => [
		uniqueIndex('periods_one_active_idx')
			.on(t.status)
			.where(sql`${t.status} = 'active'`)
	]
);

export const periodWinners = pgTable(
	'period_winners',
	{
		periodId: integer('period_id')
			.notNull()
			.references(() => periods.id, { onDelete: 'cascade' }),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id),
		points: integer('points').notNull(),
		rank: integer('rank').notNull().default(1)
	},
	(t) => [primaryKey({ columns: [t.periodId, t.userId] })]
);

export const tasks = pgTable('tasks', {
	key: text('key').primaryKey(),
	label: text('label').notNull(),
	points: integer('points').notNull(),
	cooldownSeconds: integer('cooldown_seconds').notNull().default(0),
	requiresPhoto: boolean('requires_photo').notNull().default(false),
	persistPhoto: boolean('persist_photo').notNull().default(false),
	needsReview: boolean('needs_review').notNull().default(false),
	milestone: boolean('milestone').notNull().default(false)
});

export const submissions = pgTable(
	'submissions',
	{
		id: id(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id),
		taskKey: text('task_key')
			.notNull()
			.references(() => tasks.key),
		periodId: integer('period_id').references(() => periods.id),
		status: text('status', { enum: ['pending', 'approved', 'rejected', 'revoked'] }).notNull(),
		pointsAwarded: integer('points_awarded').notNull().default(0),
		imagePath: text('image_path'),
		imageRemovedAt: timestamp('image_removed_at', { withTimezone: true }),
		rejectReason: text('reject_reason'),
		createdAt: createdAt(),
		reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
		reviewedBy: integer('reviewed_by').references(() => users.id),
		// An admin removed an approved chore: the row stays for audit but scores nothing.
		revokedAt: timestamp('revoked_at', { withTimezone: true }),
		revokedBy: integer('revoked_by').references(() => users.id),
		revokeReason: text('revoke_reason')
	},
	(t) => [
		index('submissions_user_task_idx').on(t.userId, t.taskKey, t.createdAt),
		index('submissions_period_status_idx').on(t.periodId, t.status),
		// The one-time welcome bonus: at most one such row per user, whatever else happens.
		uniqueIndex('submissions_welcome_bonus_once_idx')
			.on(t.userId)
			.where(sql`${t.taskKey} = 'welcome_bonus'`)
	]
);

export const posts = pgTable(
	'posts',
	{
		id: id(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id),
		title: text('title').notNull(),
		body: text('body').notNull().default(''),
		imagePath: text('image_path'),
		milestoneSubmissionId: integer('milestone_submission_id').references(() => submissions.id),
		createdAt: createdAt()
	},
	(t) => [
		uniqueIndex('posts_milestone_submission_idx').on(t.milestoneSubmissionId),
		index('posts_created_idx').on(t.createdAt),
		check('posts_title_length_check', sql`char_length(${t.title}) between 1 and 80`)
	]
);

export const comments = pgTable(
	'comments',
	{
		id: id(),
		postId: integer('post_id')
			.notNull()
			.references(() => posts.id, { onDelete: 'cascade' }),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id),
		body: text('body').notNull(),
		createdAt: createdAt()
	},
	(t) => [index('comments_post_idx').on(t.postId)]
);

export const reactions = pgTable(
	'reactions',
	{
		postId: integer('post_id')
			.notNull()
			.references(() => posts.id, { onDelete: 'cascade' }),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		emoji: text('emoji').notNull()
	},
	(t) => [uniqueIndex('reactions_post_user_emoji_idx').on(t.postId, t.userId, t.emoji)]
);

export const events = pgTable(
	'events',
	{
		id: id(),
		userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
		type: text('type').notNull(),
		createdAt: createdAt()
	},
	(t) => [index('events_type_created_idx').on(t.type, t.createdAt)]
);
