import { hashPassword } from '../auth/hash';
import type { Db } from './index';
import { tasks, users } from './schema';

const TASKS: (typeof tasks.$inferInsert)[] = [
	{
		key: 'cutlery',
		label: 'Put cutlery back in drawer',
		points: 1,
		cooldownSeconds: 1800,
		requiresPhoto: true,
		persistPhoto: false,
		needsReview: false,
		milestone: false
	},
	{
		key: 'dishwasher',
		label: 'Empty or run dishwasher',
		points: 2,
		cooldownSeconds: 9000,
		requiresPhoto: false,
		persistPhoto: false,
		needsReview: false,
		milestone: false
	},
	{
		key: 'grounds',
		label: 'Take coffee grounds to 2nd basement',
		points: 3,
		cooldownSeconds: 86400,
		requiresPhoto: false,
		persistPhoto: false,
		needsReview: false,
		milestone: false
	},
	{
		key: 'beans',
		label: 'Bring coffee beans',
		points: 5,
		cooldownSeconds: 0,
		requiresPhoto: true,
		persistPhoto: true,
		needsReview: true,
		milestone: false
	},
	{
		key: 'milk',
		label: 'Bring milk',
		points: 3,
		cooldownSeconds: 0,
		requiresPhoto: true,
		persistPhoto: true,
		needsReview: true,
		milestone: false
	},
	{
		key: 'descale',
		label: 'Descale coffee machine',
		points: 10,
		cooldownSeconds: 0,
		requiresPhoto: true,
		persistPhoto: true,
		needsReview: true,
		milestone: true
	},
	{
		key: 'deep_clean',
		label: 'Deep clean kitchen/fridge',
		points: 15,
		cooldownSeconds: 0,
		requiresPhoto: true,
		persistPhoto: true,
		needsReview: true,
		milestone: true
	}
];

/** Inserts the task definitions; existing rows are left untouched so admin tuning survives. */
export async function seedTasks(db: Db): Promise<void> {
	await db.insert(tasks).values(TASKS).onConflictDoNothing();
}

/** Creates the first admin if no user with that username exists. */
export async function bootstrapAdmin(db: Db, username: string, password: string): Promise<void> {
	const normalized = username.trim().toLowerCase();
	const passwordHash = await hashPassword(password);
	await db
		.insert(users)
		.values({
			usernameNormalized: normalized,
			displayUsername: username.trim(),
			passwordHash,
			role: 'admin',
			onboardingCompleted: true
		})
		.onConflictDoNothing();
}
