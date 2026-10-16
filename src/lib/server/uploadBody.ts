import { json } from '@sveltejs/kit';
import { MAX_INPUT_BYTES } from './images';

// Image limit plus a small allowance for multipart framing (5.5 MB total).
export const MAX_BODY_BYTES = MAX_INPUT_BYTES + 512 * 1024;

/**
 * Browsers always send Content-Length for fetch + FormData. Requiring it lets us refuse
 * oversized bodies before formData() buffers them. Returns an error response, or null if fine.
 */
export function checkUploadLength(request: Request): Response | null {
	const header = request.headers.get('content-length');
	if (header === null) return json({ error: 'length_required' }, { status: 411 });
	const length = Number(header);
	if (!Number.isFinite(length) || length > MAX_BODY_BYTES) {
		return json({ error: 'too_large' }, { status: 413 });
	}
	return null;
}
