// Demo data for local development: `npm run dev:seed` (add `-- --reset` to wipe and re-create).
// Local database only (see devSeedGuard.ts). Goes through the app's own service functions so the
// invariants hold; rows are only touched directly to back-date timestamps and to add analytics noise.
import { eq, isNotNull, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { signUp } from '../src/lib/server/auth/users';
import type { Db } from '../src/lib/server/db';
import { bootstrapAdmin, seedTasks } from '../src/lib/server/db/seed';
import { comments, events, periods, posts, submissions, users } from '../src/lib/server/db/schema';
import { addComment, createPost, onMilestonePost, toggleReaction } from '../src/lib/server/feed';
import { deleteUpload } from '../src/lib/server/images';
import { createPeriod, endPeriod } from '../src/lib/server/periods';
import { approve } from '../src/lib/server/review';
import { logTask, submitCutleryTask, submitPhotoTask } from '../src/lib/server/tasks';
import { EMOJIS } from '../src/lib/emoji';
import { assertDevSeedAllowed } from './devSeedGuard';
import { connect, prepareDatabase } from './setupDatabase';

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'Admin-Dev-2026!';
const MEMBER_PASSWORD = 'Kitchen-Dev-2026!';
const SEED_MARKER = 'dev_seed';
const IRG = 'Interactions Research Group';
const SSPD = 'Software Systems Programming and Development';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type Member = {
	username: string;
	name: string;
	classification: 'Student' | 'Employee';
	department?: string;
	/** Total points in the active period. */
	target: number;
	/** Self-reported logs as [task, hours ago], oldest first and spaced beyond the cooldown. */
	autos: [string, number][];
};

const AUTO_POINTS: Record<string, number> = { dishwasher: 2, grounds: 3, cutlery: 1 };

// Two share first place; demo is third with 47 points (the screenshots use that member).
const MEMBERS: Member[] = [
	{ username: 'lena', name: 'Lena Hofer', classification: 'Employee', department: IRG, target: 62, autos: [['cutlery', 5], ['dishwasher', 0.2]] },
	{ username: 'mateo', name: 'Mateo Alvarez', classification: 'Employee', department: SSPD, target: 62, autos: [['dishwasher', 9], ['grounds', 3]] },
	{ username: 'demo', name: 'Demo Member', classification: 'Student', target: 47, autos: [['grounds', 6], ['dishwasher', 1], ['cutlery', 1 / 3]] },
	{ username: 'priya', name: 'Priya Raman', classification: 'Student', target: 41, autos: [['dishwasher', 6], ['dishwasher', 2.9]] },
	{ username: 'jonas', name: 'Jonas Keller', classification: 'Employee', department: SSPD, target: 36, autos: [['grounds', 0.8]] },
	{ username: 'aiko', name: 'Aiko Tanaka', classification: 'Student', target: 33, autos: [['dishwasher', 12]] },
	{ username: 'noah', name: 'Noah Brunner', classification: 'Student', target: 28, autos: [['cutlery', 3]] },
	{ username: 'sofia', name: 'Sofia Meier', classification: 'Employee', department: IRG, target: 22, autos: [['cutlery', 1.5]] },
	{ username: 'elias', name: 'Elias Vogel', classification: 'Student', target: 19, autos: [['dishwasher', 26], ['cutlery', 8]] },
	{ username: 'amara', name: 'Amara Okafor', classification: 'Employee', department: SSPD, target: 14, autos: [] },
	{ username: 'tobias', name: 'Tobias Graf', classification: 'Employee', department: IRG, target: 9, autos: [['grounds', 30]] },
	{ username: 'mira', name: 'Mira Schmid', classification: 'Student', target: 6, autos: [] },
	{ username: 'luca', name: 'Luca Frei', classification: 'Student', target: 1, autos: [['cutlery', 4]] }
];

// The previous semester: [username, points].
const SPRING: [string, number][] = [
	['mateo', 55],
	['lena', 48],
	['priya', 40],
	['jonas', 30],
	['demo', 22],
	['aiko', 15]
];

const REVIEWED: [string, number][] = [
	['deep_clean', 15],
	['descale', 10],
	['beans', 5],
	['milk', 3]
];

/** Splits `points` into reviewed tasks (fewest items); throws if it cannot be done exactly. */
function decompose(points: number): string[] {
	const best: (string[] | null)[] = Array(points + 1).fill(null);
	best[0] = [];
	for (let p = 1; p <= points; p++) {
		for (const [key, pts] of REVIEWED) {
			const prev = p - pts >= 0 ? best[p - pts] : null;
			if (prev && (!best[p] || prev.length + 1 < best[p]!.length)) best[p] = [...prev, key];
		}
	}
	const out = best[points];
	if (!out) throw new Error(`Cannot build ${points} points from reviewed tasks`);
	return out;
}

/** Deterministic pseudo-random numbers so two seeds look alike. */
function rng(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 2 ** 32;
	};
}

const PALETTE = ['#e8845c', '#4f9d8e', '#d9b44a', '#6b7fd7', '#c8587a', '#7fb069'];

/** A colourful 1200x900 JPEG (gradient, circles) so the proof photos are easy to tell apart. */
async function makePhoto(index: number): Promise<Buffer> {
	const a = PALETTE[index % PALETTE.length];
	const b = PALETTE[(index + 2) % PALETTE.length];
	const c = PALETTE[(index + 4) % PALETTE.length];
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
<rect width="1200" height="900" fill="url(#g)"/>
<circle cx="${300 + index * 40}" cy="330" r="190" fill="${c}" fill-opacity="0.75"/>
<circle cx="${820 - index * 30}" cy="560" r="260" fill="#ffffff" fill-opacity="0.22"/>
<rect x="140" y="640" width="520" height="90" rx="45" fill="#000000" fill-opacity="0.18"/>
</svg>`;
	return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}

async function resetAll(db: Db): Promise<void> {
	const files = new Set<string>();
	for (const r of await db.select({ f: submissions.imagePath }).from(submissions).where(isNotNull(submissions.imagePath))) files.add(r.f!);
	for (const r of await db.select({ f: posts.imagePath }).from(posts).where(isNotNull(posts.imagePath))) files.add(r.f!);
	for (const r of await db.select({ f: users.avatarPath }).from(users).where(isNotNull(users.avatarPath))) files.add(r.f!);
	await db.execute(
		sql`truncate table reactions, comments, posts, period_winners, submissions, events, sessions, reset_tokens, periods, users, tasks restart identity cascade`
	);
	let removed = 0;
	for (const f of files) {
		try {
			await deleteUpload(f);
			removed++;
		} catch {
			// not one of ours (unexpected file name): leave it alone
		}
	}
	console.log(`reset: tables emptied, ${removed} uploaded file(s) removed`);
}

function printAccounts(): void {
	console.log('\nAccounts (local development only):');
	console.log(`  admin   username "${ADMIN_USERNAME}"   password "${ADMIN_PASSWORD}"`);
	console.log(`  member  username "demo"    password "${MEMBER_PASSWORD}"  (47 points, rank 3)`);
	console.log(`  others  ${MEMBERS.filter((m) => m.username !== 'demo').map((m) => m.username).join(', ')}   password "${MEMBER_PASSWORD}"`);
}

async function seed(db: Db): Promise<void> {
	const NOW = Date.now();
	const ago = (hours: number) => new Date(NOW - hours * HOUR);
	const rand = rng(2026);
	const photos = await Promise.all(Array.from({ length: PALETTE.length }, (_, i) => makePhoto(i)));
	let photoCounter = 0;
	const photo = () => photos[photoCounter++ % photos.length];

	// People.
	await bootstrapAdmin(db, ADMIN_USERNAME, ADMIN_PASSWORD);
	const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.usernameNormalized, ADMIN_USERNAME));
	const ids = new Map<string, number>();
	for (const m of MEMBERS) {
		const u = await signUp(db, {
			username: m.username,
			password: MEMBER_PASSWORD,
			classification: m.classification,
			department: m.department
		});
		await db.update(users).set({ displayUsername: m.name, onboardingCompleted: true }).where(eq(users.id, u.id));
		ids.set(m.username, u.id);
	}
	const idOf = (username: string) => ids.get(username)!;

	/** A reviewed photo task: submitted at `when`, approved half an hour later (never in the future). */
	async function earn(userId: number, taskKey: string, when: Date, milestonePost = false) {
		const sub = await submitPhotoTask(db, userId, taskKey, photo(), { now: when });
		const reviewed = new Date(Math.min(when.getTime() + 30 * 60_000, NOW));
		await approve(db, admin.id, sub.id, { now: reviewed, onMilestone: milestonePost ? onMilestonePost : undefined });
		if (milestonePost) await db.update(posts).set({ createdAt: reviewed }).where(eq(posts.milestoneSubmissionId, sub.id));
		return sub;
	}

	// Previous semester first: only one period may be active, and the leaderboard of an ended one is
	// frozen into period_winners by endPeriod.
	const spring = await createPeriod(db, 'Spring semester 2026');
	await db.update(periods).set({ startsAt: ago(24 * 230) }).where(eq(periods.id, spring.id));
	for (const [username, points] of SPRING) {
		for (const key of decompose(points)) {
			await earn(idOf(username), key, ago(24 * (105 + rand() * 115)));
		}
	}
	await endPeriod(db, spring.id);
	await db.update(periods).set({ endsAt: ago(24 * 100) }).where(eq(periods.id, spring.id));

	// The current semester.
	const autumn = await createPeriod(db, 'Autumn semester 2026');
	await db.update(periods).set({ startsAt: ago(24 * 75) }).where(eq(periods.id, autumn.id));

	for (const m of MEMBERS) {
		const userId = idOf(m.username);
		// Self-reported chores, back-dated (oldest first, so the cooldown check sees them in order).
		for (const [task, hours] of m.autos) {
			if (task === 'cutlery') await submitCutleryTask(db, userId, true, { now: ago(hours) });
			else await logTask(db, userId, task, { now: ago(hours) });
		}
		let remaining = m.target - m.autos.reduce((sum, [task]) => sum + AUTO_POINTS[task], 0);
		// The two milestone posts for the feed: Lena's descaling and Mateo's deep clean.
		if (m.username === 'lena') {
			await earn(userId, 'descale', ago(5), true);
			remaining -= 10;
		}
		if (m.username === 'mateo') {
			await earn(userId, 'deep_clean', ago(26), true);
			remaining -= 15;
		}
		for (const key of decompose(remaining)) {
			await earn(userId, key, ago(2 + rand() * 24 * 70));
		}
	}

	// Waiting for review.
	await submitPhotoTask(db, idOf('priya'), 'beans', photo(), { now: ago(0.25) });
	await submitPhotoTask(db, idOf('jonas'), 'milk', photo(), { now: ago(0.8) });
	await submitPhotoTask(db, idOf('noah'), 'descale', photo(), { now: ago(1.5) });

	// Text posts with reactions and comments.
	const textPosts: [string, string, number][] = [
		['aiko', 'Does anyone else hear the machine rattling? Maybe time to descale.', 70],
		['sofia', 'Whoever left the lemon cake on Friday: thank you, it was gone in ten minutes.', 30],
		['jonas', 'Reminder: the dishwasher is full of clean cups, please empty it before adding more.', 9],
		['priya', 'Oat milk is back in the fridge, second shelf.', 1.2]
	];
	const postIds: number[] = [];
	for (const [username, body, hours] of textPosts) {
		const p = await createPost(db, idOf(username), { body });
		await db.update(posts).set({ createdAt: ago(hours) }).where(eq(posts.id, p.id));
		postIds.push(p.id);
	}
	const feed = await db.select({ id: posts.id }).from(posts).orderBy(posts.id);
	const commentsOn: [number, string, string, number][] = [
		[postIds[0], 'mateo', 'Yes, it started on Monday. I will do it tomorrow.', 68],
		[postIds[1], 'elias', 'Missed it, again. Save me a slice next time!', 28],
		[postIds[1], 'lena', 'It was Tobias, I saw the box.', 27],
		[postIds[2], 'demo', 'On it.', 8.5],
		[postIds[3], 'demo', 'Thank you!', 1]
	];
	for (const [postId, username, body, hours] of commentsOn) {
		const c = await addComment(db, idOf(username), postId, body);
		await db.update(comments).set({ createdAt: ago(hours) }).where(eq(comments.id, c.id));
	}
	const names = MEMBERS.map((m) => m.username);
	for (const [i, post] of feed.entries()) {
		for (const [j, username] of names.entries()) {
			if ((i + j * 3) % 4 === 0) await toggleReaction(db, idOf(username), post.id, EMOJIS[(i + j) % EMOJIS.length]);
		}
	}

	// A month of app opens and submissions for the analytics charts and the heatmap.
	const hours = [8, 9, 9, 10, 10, 11, 12, 13, 14, 14, 15, 16, 17];
	const rows: { userId: number; type: string; createdAt: Date }[] = [];
	for (let day = 0; day < 30; day++) {
		const base = new Date(NOW - day * DAY);
		if ([0, 6].includes(base.getUTCDay())) continue;
		base.setUTCMinutes(0, 0, 0);
		for (const m of MEMBERS) {
			if (rand() > 0.72) continue;
			const opens = 1 + Math.floor(rand() * 3);
			for (let i = 0; i < opens; i++) {
				const at = new Date(base.getTime() - (base.getUTCHours() - hours[Math.floor(rand() * hours.length)]) * HOUR + Math.floor(rand() * 59) * 60_000);
				if (at.getTime() < NOW) rows.push({ userId: idOf(m.username), type: 'app_open', createdAt: at });
			}
			if (rand() < 0.3) {
				const at = new Date(base.getTime() - (base.getUTCHours() - hours[Math.floor(rand() * hours.length)]) * HOUR + 5 * 60_000);
				if (at.getTime() < NOW) rows.push({ userId: idOf(m.username), type: 'task_submitted', createdAt: at });
			}
		}
	}
	for (let i = 0; i < rows.length; i += 500) await db.insert(events).values(rows.slice(i, i + 500));

	// Written last: its presence means the seed ran to the end.
	await db.insert(events).values({ userId: null, type: SEED_MARKER });
}

async function count(db: Db, table: string, where = ''): Promise<number> {
	const r = await db.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${table} ${where}`));
	return r[0].n;
}

const reset = process.argv.includes('--reset');
let client: ReturnType<typeof connect>['client'] | undefined;
try {
	assertDevSeedAllowed(process.env);
	const conn = connect();
	client = conn.client;
	const db = conn.db;
	await prepareDatabase(db);

	if (reset) await resetAll(db);
	await seedTasks(db);

	const [marker] = await db.select({ id: events.id }).from(events).where(eq(events.type, SEED_MARKER)).limit(1);
	if (marker) {
		console.log('Demo data is already there; nothing changed (use --reset to start over).');
	} else {
		if ((await count(db, 'users')) > 0) {
			throw new Error(
				'This database already has data that the seed did not create. Run "npm run dev:seed -- --reset" to ' +
					'replace everything in this local database with the demo data, or point DATABASE_URL at an empty database.'
			);
		}
		await seed(db);
		console.log(
			`Seeded: ${await count(db, 'users')} users, ${await count(db, 'periods')} periods, ` +
				`${await count(db, 'submissions')} submissions (${await count(db, 'submissions', "where status = 'pending'")} pending), ` +
				`${await count(db, 'posts')} posts, ${await count(db, 'events')} events.`
		);
	}
	printAccounts();
} catch (err) {
	console.error('dev-seed failed:', err instanceof Error ? err.message : err);
	process.exitCode = 1;
} finally {
	await client?.end();
}
