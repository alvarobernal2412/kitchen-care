import { eq } from 'drizzle-orm';
import type { Db } from './db';
import { users } from './db/schema';
import { deleteUpload, processUpload } from './images';

type Opts = { dir?: string };

async function deleteQuietly(file: string | null, opts?: Opts): Promise<void> {
	if (!file) return;
	try {
		await deleteUpload(file, opts);
	} catch (err) {
		// The row already points elsewhere; a leftover file is harmless.
		console.warn('Could not delete old avatar file', err);
	}
}

/**
 * Processes and stores a new avatar (basename only in the DB), then removes the previous file
 * once the update has committed. Throws InvalidImageError for bad input, leaving things as they were.
 */
export async function setAvatar(
	db: Db,
	userId: number,
	input: Buffer,
	opts?: Opts
): Promise<string> {
	const { file } = await processUpload(input, opts);
	try {
		const old = await db.transaction(async (tx) => {
			const [row] = await tx
				.select({ avatarPath: users.avatarPath })
				.from(users)
				.where(eq(users.id, userId))
				.for('update');
			await tx.update(users).set({ avatarPath: file }).where(eq(users.id, userId));
			return row?.avatarPath ?? null;
		});
		await deleteQuietly(old, opts);
		return file;
	} catch (err) {
		await deleteQuietly(file, opts);
		throw err;
	}
}

export async function removeAvatar(db: Db, userId: number, opts?: Opts): Promise<void> {
	const old = await db.transaction(async (tx) => {
		const [row] = await tx
			.select({ avatarPath: users.avatarPath })
			.from(users)
			.where(eq(users.id, userId))
			.for('update');
		await tx.update(users).set({ avatarPath: null }).where(eq(users.id, userId));
		return row?.avatarPath ?? null;
	});
	await deleteQuietly(old, opts);
}
