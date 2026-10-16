import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { processUpload } from '../../src/lib/server/images';
import { GET } from '../../src/routes/media/[file]/+server';

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'kcc-media-'));
	process.env.UPLOAD_DIR = dir;
});
afterEach(async () => {
	delete process.env.UPLOAD_DIR;
	await rm(dir, { recursive: true, force: true });
});

async function get(file: string, authed = true) {
	try {
		const res = await GET({
			locals: { user: authed ? { id: 1 } : null },
			params: { file }
		} as unknown as Parameters<typeof GET>[0]);
		return { status: res.status, res };
	} catch (e) {
		return { status: (e as { status: number }).status, res: null };
	}
}

describe('GET /media/[file]', () => {
	it('requires login', async () => {
		expect((await get('a'.repeat(32) + '.webp', false)).status).toBe(401);
	});

	it('404s on bad names and missing files', async () => {
		expect((await get('../etc/passwd')).status).toBe(404);
		expect((await get('a'.repeat(32) + '.webp')).status).toBe(404);
	});

	it('streams the image with private caching headers', async () => {
		const buf = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } })
			.png()
			.toBuffer();
		const { file } = await processUpload(buf, { dir });
		const { status, res } = await get(file);
		expect(status).toBe(200);
		expect(res!.headers.get('content-type')).toBe('image/webp');
		expect(res!.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
		expect(res!.headers.get('x-content-type-options')).toBe('nosniff');
		expect((await res!.arrayBuffer()).byteLength).toBeGreaterThan(0);
	});
});
