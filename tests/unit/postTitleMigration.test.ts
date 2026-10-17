import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { getTestDb, type TestDb } from '../helpers/testDb';
import { users } from '../../src/lib/server/db/schema';
import { seedTasks } from '../../src/lib/server/db/seed';

let t: TestDb;
beforeAll(async () => {
	t = await getTestDb();
	await seedTasks(t.db);
});
afterAll(async () => {
	await t.close();
});

const ROLLBACK = new Error('rollback');

type Legacy = { body: string; milestoneTask?: string };

/**
 * Rewinds `posts` to its pre-migration shape inside a transaction, inserts legacy rows, runs the
 * real 0006 migration statements and reads the result. The transaction is always rolled back, so
 * the shared test database is left untouched.
 */
async function backfill(legacy: Legacy[]) {
	const [u] = await t.db
		.insert(users)
		.values({
			usernameNormalized: `mig-${Math.random()}`,
			displayUsername: 'mig',
			passwordHash: 'x'
		})
		.returning();
	const migration = (await readFile('drizzle/0006_post_title.sql', 'utf8'))
		.split('--> statement-breakpoint')
		.map((s) => s.trim())
		.filter(Boolean);
	let rows: { title: string; ok: boolean }[] = [];
	let insertWithoutTitleFails = false;
	await t.db
		.transaction(async (tx) => {
			await tx.execute(sql.raw('ALTER TABLE "posts" DROP CONSTRAINT "posts_title_length_check"'));
			await tx.execute(sql.raw('ALTER TABLE "posts" DROP COLUMN "title"'));
			for (const l of legacy) {
				let submissionId: number | null = null;
				if (l.milestoneTask) {
					const made = await tx.execute<{ id: number }>(
						sql`insert into submissions (user_id, task_key, status, points_awarded)
							values (${u.id}, ${l.milestoneTask}, 'approved', 10) returning id`
					);
					submissionId = made[0].id;
				}
				await tx.execute(
					sql`insert into posts (user_id, body, milestone_submission_id)
						values (${u.id}, ${l.body}, ${submissionId})`
				);
			}
			for (const stmt of migration) await tx.execute(sql.raw(stmt));
			const read = await tx.execute<{ title: string; ok: boolean }>(
				sql`select title, char_length(title) between 1 and 80 as ok from posts order by id`
			);
			rows = read.map((r) => ({ title: r.title, ok: r.ok }));
			// The temporary default is gone again, so a plain insert without a title must fail.
			insertWithoutTitleFails = await tx
				.execute(sql`insert into posts (user_id, body) values (${u.id}, 'x')`)
				.then(
					() => false,
					() => true
				);
			throw ROLLBACK;
		})
		.catch((e) => {
			if (e !== ROLLBACK) throw e;
		});
	return { rows, insertWithoutTitleFails };
}

describe('migration 0006 (required post titles)', () => {
	it('backfills titles from the first line, the chore label, or a fallback', async () => {
		const { rows, insertWithoutTitleFails } = await backfill([
			{ body: 'Hello kitchen\nsecond line' },
			{ body: 'x'.repeat(200) },
			{ body: '😀'.repeat(100) },
			{ body: '' },
			{ body: '\nstarts with a blank line' },
			{ body: 'Lena did a thing\nand more', milestoneTask: 'descale' }
		]);
		expect(rows.map((r) => r.title)).toEqual([
			'Hello kitchen',
			'x'.repeat(80),
			'😀'.repeat(80),
			'Post',
			'Post',
			'Descale coffee machine'
		]);
		expect(rows.every((r) => r.ok)).toBe(true);
		expect(insertWithoutTitleFails).toBe(true);
	});

	it('is a no-op on an empty posts table', async () => {
		const { rows, insertWithoutTitleFails } = await backfill([]);
		expect(rows).toEqual([]);
		expect(insertWithoutTitleFails).toBe(true);
	});
});
