import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getTestDb, type TestDb } from '../helpers/testDb';
import { posts, users } from '../../src/lib/server/db/schema';
import { seedTasks } from '../../src/lib/server/db/seed';
import { createPeriod } from '../../src/lib/server/periods';
import { submitPhotoTask } from '../../src/lib/server/tasks';

let t: TestDb;
vi.mock('$lib/server/db', () => ({ getDb: () => t.db }));

let dir: string;
let memberId: number;
let admin: { id: number; role: 'admin'; active: true };

beforeAll(async () => {
	t = await getTestDb();
	dir = await mkdtemp(join(tmpdir(), 'kcc-action-'));
	await seedTasks(t.db);
	await createPeriod(t.db, 'Test');
	const [m] = await t.db
		.insert(users)
		.values({ usernameNormalized: 'mem', displayUsername: 'mem', passwordHash: 'x' })
		.returning();
	const [a] = await t.db
		.insert(users)
		.values({ usernameNormalized: 'adm', displayUsername: 'adm', passwordHash: 'x', role: 'admin' })
		.returning();
	memberId = m.id;
	admin = { id: a.id, role: 'admin', active: true };
});
afterAll(async () => {
	await t.close();
	await rm(dir, { recursive: true, force: true });
});

async function approveViaAction(submissionId: number) {
	const { actions } = await import('../../src/routes/(admin)/admin/review/+page.server');
	const body = new FormData();
	body.set('submissionId', String(submissionId));
	const request = new Request('http://localhost/admin/review?/approve', { method: 'POST', body });
	return (actions.approve as (e: unknown) => Promise<unknown>)({
		request,
		locals: { user: admin }
	});
}

describe('admin review approve action', () => {
	it('creates the milestone post for descale but not for beans', async () => {
		const photo = await sharp({
			create: { width: 64, height: 64, channels: 3, background: '#3a3' }
		})
			.jpeg()
			.toBuffer();
		const beans = await submitPhotoTask(t.db, memberId, 'beans', photo, { uploadDir: dir });
		const descale = await submitPhotoTask(t.db, memberId, 'descale', photo, { uploadDir: dir });

		await approveViaAction(beans.id);
		expect(await t.db.select().from(posts)).toHaveLength(0);

		expect(await approveViaAction(descale.id)).toEqual({ approved: descale.id });
		const rows = await t.db.select().from(posts);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			userId: memberId,
			milestoneSubmissionId: descale.id,
			imagePath: descale.imagePath
		});
	});
});
