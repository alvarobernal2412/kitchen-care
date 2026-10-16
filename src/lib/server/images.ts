import { randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

export const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_SIDE = 1080;
const WEBP_QUALITY = 80;
const MAX_INPUT_PIXELS = 40_000_000;
// sharp reports HEIC as "heif". Whether it can decode depends on the libvips build.
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'heif']);
const FILE_PATTERN = /^[0-9a-f]{32}\.webp$/;

export class InvalidImageError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'InvalidImageError';
	}
}

type Opts = { dir?: string };

function uploadDir(opts?: Opts): string {
	return resolve(opts?.dir ?? process.env.UPLOAD_DIR ?? './uploads');
}

export function resolveUploadPath(file: string, opts?: Opts): string {
	if (typeof file !== 'string' || !FILE_PATTERN.test(file)) {
		throw new InvalidImageError('Invalid upload file name');
	}
	return join(uploadDir(opts), file);
}

export async function processUpload(
	buf: Buffer,
	opts?: Opts
): Promise<{ file: string; bytes: number }> {
	if (buf.length > MAX_INPUT_BYTES) throw new InvalidImageError('Image is larger than 5 MB');

	let out: Buffer;
	try {
		const input = sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS });
		const meta = await input.metadata();
		if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) {
			throw new InvalidImageError('Unsupported image format');
		}
		// rotate() applies EXIF orientation; sharp drops all metadata unless asked to keep it.
		out = await input
			.rotate()
			.resize({
				width: MAX_SIDE,
				height: MAX_SIDE,
				fit: 'inside',
				withoutEnlargement: true
			})
			.webp({ quality: WEBP_QUALITY })
			.toBuffer();
	} catch (e) {
		if (e instanceof InvalidImageError) throw e;
		throw new InvalidImageError('File is not a valid image');
	}

	const dir = uploadDir(opts);
	await mkdir(dir, { recursive: true });
	const file = `${randomBytes(16).toString('hex')}.webp`;
	await writeFile(join(dir, file), out, { flag: 'wx' });
	return { file, bytes: out.length };
}

export async function deleteUpload(file: string, opts?: Opts): Promise<void> {
	const path = resolveUploadPath(file, opts);
	try {
		await unlink(path);
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
	}
}
