import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import sharp from 'sharp';
import * as schema from '../../src/lib/server/db/schema';
import { E2E_UPLOAD_DIR } from './env';
import { createUser, db, uniqueUsername } from './helpers';

const IRG = 'Interactions Research Group';
const SSPD = 'Software Systems Programming and Development';

export type ShowcaseUser = { id: number; username: string; password: string; name: string };

export type Showcase = {
	/** A signed-in member with points, a pending submission, posts and an ended period behind them. */
	me: ShowcaseUser;
	others: ShowcaseUser[];
	/** Removes every row and nothing else the showcase created (users stay, they are unique). */
	cleanup: () => Promise<void>;
};

/** Writes a real WebP photo into the upload directory; returns its stored file name. */
export async function writeProof(color = '#7a8f86'): Promise<string> {
	const file = `${randomBytes(16).toString('hex')}.webp`;
	await mkdir(E2E_UPLOAD_DIR, { recursive: true });
	const buf = await sharp({ create: { width: 800, height: 600, channels: 3, background: color } })
		.webp()
		.toBuffer();
	await writeFile(join(E2E_UPLOAD_DIR, file), buf);
	return file;
}

async function mkUser(
	prefix: string,
	name: string,
	opts: { classification: 'Student' | 'Employee'; department?: string; active?: boolean }
): Promise<ShowcaseUser> {
	const creds = await createUser(uniqueUsername(prefix));
	const [row] = await db
		.update(schema.users)
		.set({
			classification: opts.classification,
			department: (opts.department as (typeof schema.DEPARTMENTS)[number]) ?? null,
			active: opts.active ?? true,
			displayUsername: name
		})
		.where(eq(schema.users.usernameNormalized, creds.username.toLowerCase()))
		.returning();
	return { ...creds, id: row.id, name };
}

/**
 * Fills the e2e database with a believable month: a tied leaderboard, pending reviews with photos,
 * posts with comments and reactions, an ended period with winners and a week of activity. Used by
 * the accessibility spec and by the screenshot script. Clears the pending rows and posts of other
 * specs first, so what is on screen is only this.
 */
export async function seedShowcase(): Promise<Showcase> {
	await db.delete(schema.posts);
	await db.delete(schema.submissions).where(eq(schema.submissions.status, 'pending'));

	const [active] = await db.select().from(schema.periods).where(eq(schema.periods.status, 'active'));
	const me = await mkUser('show-me', 'Mia Torres', { classification: 'Student' });
	const ana = await mkUser('show-ana', 'Ana Lindqvist', { classification: 'Employee', department: IRG });
	const ben = await mkUser('show-ben', 'Ben Okafor', { classification: 'Employee', department: IRG });
	const cleo = await mkUser('show-cleo', 'Cleo', { classification: 'Student' });
	const dev = await mkUser('show-dev', 'Dev Patel-Wainwright-Longname', { classification: 'Employee', department: SSPD });
	const gone = await mkUser('show-gone', 'Eli Retired', { classification: 'Student', active: false });
	const others = [ana, ben, cleo, dev, gone];
	const all = [me, ...others];

	const periodIds: number[] = [];
	const day = 86_400_000;
	const award = async (userId: number, taskKey: string, points: number, ageMinutes = 120) =>
		(
			await db
				.insert(schema.submissions)
				.values({
					userId,
					taskKey,
					periodId: active.id,
					status: 'approved',
					pointsAwarded: points,
					createdAt: new Date(Date.now() - ageMinutes * 60_000)
				})
				.returning()
		)[0];

	// Ana and Ben tie for first.
	for (const [u, pts] of [
		[ana, 20],
		[ben, 20],
		[me, 12],
		[dev, 7],
		[cleo, 3]
	] as const) {
		await award(u.id, 'milk', pts);
	}
	const milestone = await award(ana.id, 'descale', 10, 60);

	// Waiting for review, with photos.
	for (const [u, task, age] of [
		[me, 'descale', 8],
		[cleo, 'deep_clean', 25],
		[dev, 'beans', 90]
	] as const) {
		const imagePath = await writeProof();
		await db.insert(schema.submissions).values({
			userId: u.id,
			taskKey: task,
			periodId: active.id,
			status: 'pending',
			imagePath,
			createdAt: new Date(Date.now() - age * 60_000)
		});
	}

	// Feed.
	const [p1] = await db
		.insert(schema.posts)
		.values({
			userId: ana.id,
			body: 'Descaled the coffee machine. It sounds happier already.',
			milestoneSubmissionId: milestone.id,
			imagePath: await writeProof('#8fa39a'),
			createdAt: new Date(Date.now() - 50 * 60_000)
		})
		.returning();
	const [p2] = await db
		.insert(schema.posts)
		.values({
			userId: me.id,
			body: 'Whoever keeps bringing oat milk: thank you.',
			createdAt: new Date(Date.now() - 5 * 3_600_000)
		})
		.returning();
	const [p3] = await db
		.insert(schema.posts)
		.values({ userId: ben.id, body: 'Quiet kitchen this morning.', createdAt: new Date(Date.now() - 2 * day) })
		.returning();
	await db.insert(schema.comments).values([
		{ postId: p1.id, userId: me.id, body: 'You are a hero.', createdAt: new Date(Date.now() - 40 * 60_000) },
		{ postId: p1.id, userId: ben.id, body: 'Finally!', createdAt: new Date(Date.now() - 30 * 60_000) },
		{ postId: p2.id, userId: cleo.id, body: 'That was me.', createdAt: new Date(Date.now() - 4 * 3_600_000) }
	]);
	await db.insert(schema.reactions).values([
		{ postId: p1.id, userId: me.id, emoji: '❤️' },
		{ postId: p1.id, userId: ben.id, emoji: '👏' },
		{ postId: p1.id, userId: cleo.id, emoji: '👏' },
		{ postId: p2.id, userId: ana.id, emoji: '☕' },
		{ postId: p3.id, userId: me.id, emoji: '🙌' }
	]);

	// An ended period with winners (history, admin periods).
	const [old] = await db
		.insert(schema.periods)
		.values({
			name: 'Spring semester (showcase)',
			startsAt: new Date(Date.now() - 120 * day),
			endsAt: new Date(Date.now() - 60 * day),
			status: 'ended'
		})
		.returning();
	periodIds.push(old.id);
	await db.insert(schema.submissions).values([
		{ userId: ben.id, taskKey: 'milk', periodId: old.id, status: 'approved', pointsAwarded: 48 },
		{ userId: me.id, taskKey: 'milk', periodId: old.id, status: 'approved', pointsAwarded: 31 }
	]);
	await db.insert(schema.periodWinners).values([
		{ periodId: old.id, userId: ben.id, points: 48, rank: 1 },
		{ periodId: old.id, userId: me.id, points: 31, rank: 2 }
	]);

	// A week of activity for the analytics page.
	const events: { userId: number; type: string; createdAt: Date }[] = [];
	for (const u of all) {
		for (let d = 0; d < 7; d++) {
			for (let i = 0; i < 1 + ((d + u.id) % 4); i++) {
				events.push({ userId: u.id, type: 'app_open', createdAt: new Date(Date.now() - d * day - i * 3_600_000) });
			}
			if (d % 2 === 0) {
				events.push({ userId: u.id, type: 'task_submitted', createdAt: new Date(Date.now() - d * day - 7_200_000) });
			}
		}
	}
	await db.insert(schema.events).values(events);

	const ids = all.map((u) => u.id);
	return {
		me,
		others,
		cleanup: async () => {
			await db.delete(schema.posts);
			await db.delete(schema.periodWinners).where(inArray(schema.periodWinners.userId, ids));
			await db.delete(schema.submissions).where(inArray(schema.submissions.userId, ids));
			await db.delete(schema.events).where(inArray(schema.events.userId, ids));
			for (const id of periodIds) {
				await db.delete(schema.periodWinners).where(eq(schema.periodWinners.periodId, id));
				await db.delete(schema.submissions).where(eq(schema.submissions.periodId, id));
				await db.delete(schema.periods).where(eq(schema.periods.id, id));
			}
		}
	};
}
