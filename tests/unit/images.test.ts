import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	InvalidImageError,
	deleteUpload,
	processUpload,
	resolveUploadPath
} from '../../src/lib/server/images';

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'kcc-img-'));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

function noisy(width: number, height: number): Buffer {
	const raw = Buffer.alloc(width * height * 3);
	for (let i = 0; i < raw.length; i++) {
		const x = Math.floor(i / 3) % width;
		raw[i] = (x / width) * 200 + Math.random() * 40;
	}
	return raw;
}

async function jpeg(width: number, height: number, orientation?: number): Promise<Buffer> {
	return sharp(noisy(width, height), { raw: { width, height, channels: 3 } })
		.jpeg({ quality: 80 })
		.withExif({
			IFD0: { Copyright: 'x' },
			IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '40/1 0/1 0/1' }
		})
		.withMetadata(orientation ? { orientation } : {})
		.toBuffer();
}

describe('processUpload', () => {
	it('re-encodes to webp, max side 1080, no EXIF', async () => {
		const input = await jpeg(4000, 3000);
		expect((await sharp(input).metadata()).exif).toBeDefined();
		const { file, bytes } = await processUpload(input, { dir });
		expect(file).toMatch(/^[0-9a-f]{32}\.webp$/);
		const meta = await sharp(await readFile(join(dir, file))).metadata();
		expect(meta.format).toBe('webp');
		expect(meta.width).toBe(1080);
		expect(meta.height).toBe(810);
		expect(meta.exif).toBeUndefined();
		expect(bytes).toBeGreaterThan(0);
		expect(bytes).toBeLessThan(250 * 1024);
	});

	it('applies EXIF orientation before stripping it', async () => {
		const input = await jpeg(400, 200, 6);
		const { file } = await processUpload(input, { dir });
		const meta = await sharp(await readFile(join(dir, file))).metadata();
		expect(meta.width).toBe(200);
		expect(meta.height).toBe(400);
		expect(meta.orientation ?? 1).toBe(1);
	});

	it('does not upscale small images', async () => {
		const { file } = await processUpload(await jpeg(300, 200), { dir });
		const meta = await sharp(await readFile(join(dir, file))).metadata();
		expect([meta.width, meta.height]).toEqual([300, 200]);
	});

	it('creates the directory if missing', async () => {
		const nested = join(dir, 'a', 'b');
		const { file } = await processUpload(await jpeg(100, 100), { dir: nested });
		expect(await readdir(nested)).toEqual([file]);
	});

	it('uses distinct random names', async () => {
		const input = await jpeg(100, 100);
		const a = await processUpload(input, { dir });
		const b = await processUpload(input, { dir });
		expect(a.file).not.toBe(b.file);
	});

	it('rejects text', async () => {
		await expect(processUpload(Buffer.from('hello world'), { dir })).rejects.toBeInstanceOf(
			InvalidImageError
		);
	});

	it('rejects SVG', async () => {
		const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
		await expect(processUpload(svg, { dir })).rejects.toBeInstanceOf(InvalidImageError);
	});

	it('rejects GIF', async () => {
		const gif = await sharp(noisy(10, 10), {
			raw: { width: 10, height: 10, channels: 3 }
		})
			.gif()
			.toBuffer();
		await expect(processUpload(gif, { dir })).rejects.toBeInstanceOf(InvalidImageError);
	});

	it('rejects over 5 MB without decoding', async () => {
		await expect(processUpload(Buffer.alloc(6 * 1024 * 1024), { dir })).rejects.toBeInstanceOf(
			InvalidImageError
		);
	});

	it('rejects decompression bombs', async () => {
		const huge = await sharp({
			create: { width: 9000, height: 9000, channels: 3, background: '#fff' }
		})
			.png()
			.toBuffer();
		expect(huge.length).toBeLessThan(5 * 1024 * 1024);
		await expect(processUpload(huge, { dir })).rejects.toBeInstanceOf(InvalidImageError);
	});

	it('writes nothing on rejection', async () => {
		await processUpload(Buffer.from('nope'), { dir }).catch(() => {});
		expect(await readdir(dir)).toEqual([]);
	});
});

describe('deleteUpload / resolveUploadPath', () => {
	it('rejects traversal and malformed names', async () => {
		await expect(deleteUpload('../../etc/passwd', { dir })).rejects.toThrow();
		await expect(deleteUpload('x.webp', { dir })).rejects.toThrow();
		expect(() => resolveUploadPath('../' + 'a'.repeat(32) + '.webp', { dir })).toThrow();
	});

	it('deletes an existing file', async () => {
		const { file } = await processUpload(await jpeg(100, 100), { dir });
		await deleteUpload(file, { dir });
		await expect(access(join(dir, file))).rejects.toThrow();
	});

	it('is a no-op for a missing file', async () => {
		await expect(deleteUpload('a'.repeat(32) + '.webp', { dir })).resolves.toBeUndefined();
	});

	it('resolves a valid name to an absolute path in dir', async () => {
		const name = 'b'.repeat(32) + '.webp';
		await writeFile(join(dir, name), 'x');
		expect(resolveUploadPath(name, { dir })).toBe(join(dir, name));
	});
});
