import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { getTestDb, type TestDb } from '../helpers/testDb';
import {
	comments,
	events,
	posts,
	reactions,
	resetTokens,
	sessions,
	submissions,
	users
} from '../../src/lib/server/db/schema';
import { AuthError, signUp } from '../../src/lib/server/auth/users';
import { login } from '../../src/lib/server/auth/session';
import { setAvatar } from '../../src/lib/server/avatar';
import { eraseAccount, LastAdminError } from '../../src/lib/server/auth/erase';
import { seedTasks } from '../../src/lib/server/db/seed';
import { processUpload } from '../../src/lib/server/images';
import sharp from 'sharp';

const PW = 'Abcdef1!';

let t: TestDb;
let dir: string;
beforeAll(async () => {
	t = await getTestDb();
	await seedTasks(t.db);
	dir = await mkdtemp(join(tmpdir(), 'kc-erase-'));
});
afterAll(async () => {
	await t.close();
	await rm(dir, { recursive: true, force: true });
});

const mk = async (name: string, role?: 'admin') => {
	const u = await signUp(t.db, { username: name, password: PW, classification: 'Student' });
	if (role) await t.db.update(users).set({ role }).where(eq(users.id, u.id));
	return u;
};

const png = () =>
	sharp({ create: { width: 8, height: 8, channels: 3, background: '#888' } })
		.png()
		.toBuffer();

describe('eraseAccount', () => {
	it('rejects a wrong password and changes nothing', async () => {
		const u = await mk('er-wrong');
		await expect(eraseAccount(t.db, u.id, 'nope', { dir })).rejects.toBeInstanceOf(AuthError);
		const [r] = await t.db.select().from(users).where(eq(users.id, u.id));
		expect(r.displayUsername).toBe('er-wrong');
		expect(r.active).toBe(true);
	});

	it('anonymises the user, removes personal content and files, keeps point history', async () => {
		const u = await mk('er-full');
		const other = await mk('er-other');
		await login(t.db, 'er-full', PW);
		await t.db.insert(resetTokens).values({
			tokenHash: 'h-er-full',
			userId: u.id,
			expiresAt: new Date(Date.now() + 60_000)
		});
		await setAvatar(t.db, u.id, await png(), { dir });
		const proof = await processUpload(await png(), { dir });
		const [sub] = await t.db
			.insert(submissions)
			.values({
				userId: u.id,
				taskKey: 'welcome_bonus',
				status: 'approved',
				pointsAwarded: 10,
				imagePath: proof.file
			})
			.returning();
		const [post] = await t.db.insert(posts).values({ userId: u.id, title: 't', body: 'b' }).returning();
		const [otherPost] = await t.db
			.insert(posts)
			.values({ userId: other.id, title: 'o', body: 'b' })
			.returning();
		await t.db.insert(comments).values([
			{ postId: post.id, userId: other.id, body: 'on mine' },
			{ postId: otherPost.id, userId: u.id, body: 'mine on theirs' }
		]);
		await t.db.insert(reactions).values({ postId: otherPost.id, userId: u.id, emoji: '👍' });
		await t.db.insert(events).values({ userId: u.id, type: 'app_open' });

		await eraseAccount(t.db, u.id, PW, { dir });

		const [r] = await t.db.select().from(users).where(eq(users.id, u.id));
		expect(r.displayUsername).toBe('Deleted user');
		expect(r.usernameNormalized).toBe(`deleted-${u.id}`);
		expect(r.active).toBe(false);
		expect(r.avatarPath).toBeNull();
		expect(r.classification).toBeNull();
		expect(r.department).toBeNull();
		await expect(login(t.db, 'er-full', PW)).rejects.toBeInstanceOf(AuthError);

		expect(await t.db.select().from(sessions).where(eq(sessions.userId, u.id))).toHaveLength(0);
		expect(await t.db.select().from(resetTokens).where(eq(resetTokens.userId, u.id))).toHaveLength(0);
		expect(await t.db.select().from(posts).where(eq(posts.userId, u.id))).toHaveLength(0);
		expect(await t.db.select().from(comments).where(eq(comments.userId, u.id))).toHaveLength(0);
		expect(await t.db.select().from(reactions).where(eq(reactions.userId, u.id))).toHaveLength(0);
		expect(await t.db.select().from(events).where(eq(events.userId, u.id))).toHaveLength(0);
		// Comments of others on the deleted post went with it; the other user's own post stays.
		expect(await t.db.select().from(posts).where(eq(posts.id, otherPost.id))).toHaveLength(1);

		const [s] = await t.db.select().from(submissions).where(eq(submissions.id, sub.id));
		expect(s.pointsAwarded).toBe(10);
		expect(s.imagePath).toBeNull();
		expect(s.imageRemovedAt).not.toBeNull();
		expect(await readdir(dir)).toHaveLength(0);
	});

	it('refuses to remove the last active admin', async () => {
		const a = await mk('er-admin', 'admin');
		await expect(eraseAccount(t.db, a.id, PW, { dir })).rejects.toBeInstanceOf(LastAdminError);
	});

	it('lets an admin go when another active admin exists', async () => {
		const a = await mk('er-admin2', 'admin');
		await expect(eraseAccount(t.db, a.id, PW, { dir })).resolves.toBeUndefined();
	});
});
