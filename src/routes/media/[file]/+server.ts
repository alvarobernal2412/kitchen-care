import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { error } from '@sveltejs/kit';
import { InvalidImageError, resolveUploadPath } from '$lib/server/images';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) error(401, 'Sign in required');
	if (!locals.user.active) error(403, 'Account is not active');

	let path: string;
	try {
		path = resolveUploadPath(params.file);
	} catch (e) {
		if (e instanceof InvalidImageError) error(404, 'Not found');
		throw e;
	}

	let size: number;
	try {
		size = (await stat(path)).size;
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') error(404, 'Not found');
		throw e;
	}

	return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
		headers: {
			'Content-Type': 'image/webp',
			'Content-Length': String(size),
			'Cache-Control': 'private, max-age=31536000, immutable',
			'X-Content-Type-Options': 'nosniff'
		}
	});
};
