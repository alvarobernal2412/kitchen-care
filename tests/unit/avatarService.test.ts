import { access, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getTestDb, type TestDb } from '../helpers/testDb';
import { users } from '../../src/lib/server/db/schema';
import { signUp } from '../../src/lib/server/auth/users';
import { InvalidImageError } from '../../src/lib/server/images';
import { removeAvatar, setAvatar } from '../../src/lib/server/avatar';

let t: TestDb;
let dir: string;
beforeAll(async () => {
	t = await getTestDb();
});
afterAll(async () => {
	await t.close();
});
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'kcc-avatar-'));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

const png = () =>
	sharp({ create: { width: 64, height: 64, channels: 3, background: '#3366cc' } }).png().toBuffer();
const avatarOf = async (id: number) =>
	(await t.db.select().from(users).where(eq(users.id, id)))[0].avatarPath;
const exists = (f: string) => access(join(dir, f)).then(() => true, () => false);

describe('avatar service', () => {
	it('stores only the basename and deletes the previous file on replace', async () => {
		const u = await signUp(t.db, { username: 'av1', password: 'Abcdef1!', classification: 'Student' });
		const first = await setAvatar(t.db, u.id, await png(), { dir });
		expect(first).toMatch(/^[0-9a-f]{32}\.webp$/);
		expect(await avatarOf(u.id)).toBe(first);
		const second = await setAvatar(t.db, u.id, await png(), { dir });
		expect(second).not.toBe(first);
		expect(await avatarOf(u.id)).toBe(second);
		expect(await exists(first)).toBe(false);
		expect(await exists(second)).toBe(true);
	});

	it('rejects a non-image without touching the existing avatar', async () => {
		const u = await signUp(t.db, { username: 'av2', password: 'Abcdef1!', classification: 'Student' });
		const first = await setAvatar(t.db, u.id, await png(), { dir });
		await expect(setAvatar(t.db, u.id, Buffer.from('not an image'), { dir })).rejects.toBeInstanceOf(
			InvalidImageError
		);
		expect(await avatarOf(u.id)).toBe(first);
		expect(await exists(first)).toBe(true);
		expect(await readdir(dir)).toEqual([first]);
	});

	it('removeAvatar clears the column and the file, and tolerates a missing file or no avatar', async () => {
		const u = await signUp(t.db, { username: 'av3', password: 'Abcdef1!', classification: 'Student' });
		await removeAvatar(t.db, u.id, { dir }); // nothing to remove
		const f = await setAvatar(t.db, u.id, await png(), { dir });
		await removeAvatar(t.db, u.id, { dir });
		expect(await avatarOf(u.id)).toBeNull();
		expect(await exists(f)).toBe(false);
	});
});
