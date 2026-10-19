import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getTestDb, type TestDb } from '../helpers/testDb';
import { comments, posts, reactions, submissions } from '../../src/lib/server/db/schema';
import { signUp } from '../../src/lib/server/auth/users';
import { seedTasks } from '../../src/lib/server/db/seed';
import { exportUserData } from '../../src/lib/server/dataExport';

let t: TestDb;
beforeAll(async () => {
	t = await getTestDb();
	await seedTasks(t.db);
});
afterAll(async () => {
	await t.close();
});

describe('exportUserData', () => {
	it('returns only the requesting user\'s data and no secrets', async () => {
		const a = await signUp(t.db, { username: 'ex-a', password: 'Abcdef1!', classification: 'Employee', department: 'Interactions Research Group' });
		const b = await signUp(t.db, { username: 'ex-b', password: 'Abcdef1!', classification: 'Student' });
		await t.db.insert(submissions).values([
			{ userId: a.id, taskKey: 'welcome_bonus', status: 'approved', pointsAwarded: 10 },
			{ userId: b.id, taskKey: 'welcome_bonus', status: 'approved', pointsAwarded: 10 }
		]);
		const [pa] = await t.db.insert(posts).values({ userId: a.id, title: 'mine', body: 'x' }).returning();
		const [pb] = await t.db.insert(posts).values({ userId: b.id, title: 'theirs', body: 'y' }).returning();
		await t.db.insert(comments).values([
			{ postId: pb.id, userId: a.id, body: 'a on b' },
			{ postId: pa.id, userId: b.id, body: 'b on a' }
		]);
		await t.db.insert(reactions).values({ postId: pb.id, userId: a.id, emoji: '👍' });

		const data = await exportUserData(t.db, a.id);
		expect(data.profile.username).toBe('ex-a');
		expect(data.profile.classification).toBe('Employee');
		expect(data.profile.department).toBe('Interactions Research Group');
		expect(data.submissions).toHaveLength(1);
		expect(data.posts.map((p) => p.title)).toEqual(['mine']);
		expect(data.comments.map((c) => c.body)).toEqual(['a on b']);
		expect(data.reactions).toEqual([{ postId: pb.id, emoji: '👍' }]);
		expect(JSON.stringify(data)).not.toMatch(/password|hash/i);
	});
});
