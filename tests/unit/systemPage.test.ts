import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getTestDb, type TestDb } from '../helpers/testDb';
import { COLLECTOR_TIMEOUT_MS, collectSystem } from '../../src/lib/server/system/collect';
import { resetPhotoCache } from '../../src/lib/server/system/photos';

let t: TestDb;
let uploads: string;
beforeAll(async () => {
	t = await getTestDb();
	uploads = await mkdtemp(join(tmpdir(), 'kc-uploads-'));
	await writeFile(join(uploads, 'a.webp'), 'x');
});
afterAll(async () => {
	await t.close();
	await rm(uploads, { recursive: true, force: true });
});

vi.mock('$lib/server/db', async () => {
	const real = await vi.importActual<object>('$lib/server/db');
	return { ...real, getDb: () => (globalThis as { __sysDb?: unknown }).__sysDb };
});

async function statusOf(run: () => unknown): Promise<number | null> {
	try {
		await run();
		return null;
	} catch (e) {
		return (e as { status?: number }).status ?? -1;
	}
}

describe('System page load', () => {
	it('403 for a non-admin, 401 for anonymous', async () => {
		const { load } = await import('../../src/routes/(admin)/admin/system/+page.server');
		const run = (user: unknown) => () => (load as (e: unknown) => unknown)({ locals: { user } });
		expect(await statusOf(run({ id: 1, role: 'user', active: true }))).toBe(403);
		expect(await statusOf(run(null))).toBe(401);
	});

	it('returns the snapshot to an admin, with no secrets, paths or connection strings', async () => {
		(globalThis as { __sysDb?: unknown }).__sysDb = t.db;
		process.env.UPLOAD_DIR = uploads;
		process.env.APP_VERSION = 'abc123def456';
		process.env.SECRET_PROBE_VALUE = 'super-secret-probe-value';
		resetPhotoCache();
		const { load } = await import('../../src/routes/(admin)/admin/system/+page.server');
		const data = (await (load as (e: unknown) => Promise<Record<string, unknown>>)({
			locals: { user: { id: 1, role: 'admin', active: true } }
		})) as { snapshot: Awaited<ReturnType<typeof collectSystem>>; updatedAt: string };

		expect(data.updatedAt).toMatch(/^\d{2}:\d{2}:\d{2}$/);
		expect(data.snapshot.database?.reachable).toBe(true);
		expect(data.snapshot.photos?.count).toBe(1);
		expect(data.snapshot.app?.version).toBe('abc123def456');
		expect(data.snapshot.overall.level).toMatch(/^(ok|attention|critical)$/);

		const json = JSON.stringify(data);
		expect(json).not.toContain(uploads);
		expect(json).not.toContain('super-secret-probe-value');
		for (const key of Object.keys(process.env)) {
			if (key.length > 6 && /^[A-Z_]+$/.test(key)) expect(json).not.toContain(`"${key}"`);
		}
		for (const needle of ['/proc', '/sys/fs/cgroup', 'postgres://', 'postgresql://', 'DATABASE_URL']) {
			expect(json).not.toContain(needle);
		}
		delete process.env.SECRET_PROBE_VALUE;
	});
});

describe('collectSystem', () => {
	it('shows one failing collector as unavailable without failing the rest', async () => {
		const s = await collectSystem({
			getDb: () => {
				throw new Error('boom');
			},
			uploadDir: uploads
		});
		expect(s.database).toBeNull();
		expect(s.activity).toBeNull();
		expect(s.photos?.count).toBe(1);
		expect(s.app).not.toBeNull();
		expect(s.overall.unavailable).toContain('Database');
		expect(s.overall.level).not.toBe('critical'); // unavailable alone is not critical
	});

	it('gives up on a collector that hangs', async () => {
		const never = new Proxy({}, { get: () => () => new Promise(() => {}) });
		const t0 = performance.now();
		const s = await collectSystem({ getDb: () => never as never, uploadDir: uploads, timeoutMs: 150 });
		expect(performance.now() - t0).toBeLessThan(COLLECTOR_TIMEOUT_MS);
		expect(s.database).toBeNull();
		expect(s.photos).not.toBeNull();
	});

	it('reports an unreachable database as critical', async () => {
		const closed = await getTestDb();
		await closed.close();
		const s = await collectSystem({ getDb: () => closed.db, uploadDir: uploads });
		expect(s.database).toMatchObject({ reachable: false });
		expect(s.overall.level).toBe('critical');
		expect(s.overall.reasons).toContain('Database unreachable');
	});
});
