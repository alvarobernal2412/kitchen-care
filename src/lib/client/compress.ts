const MAX_SIDE = 1080;
const MAX_BYTES = 250 * 1024;
const QUALITY_STEPS = [0.8, 0.7, 0.6, 0.5];

/** Scale so the longest side is at most `max`, preserving aspect ratio; never upscales. */
export function fitWithin(
	width: number,
	height: number,
	max: number
): { width: number; height: number } {
	const scale = Math.min(1, max / Math.max(width, height));
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale))
	};
}

function sourceSize(source: ImageBitmap | HTMLVideoElement | HTMLCanvasElement) {
	if (source instanceof HTMLVideoElement) {
		return { width: source.videoWidth, height: source.videoHeight };
	}
	return { width: source.width, height: source.height };
}

export type Encode = (type: 'image/webp' | 'image/jpeg', quality: number) => Promise<Blob | null>;

/**
 * Prefers WebP; if the browser silently returns another type (iOS/WebKit), uses JPEG instead.
 * Steps quality down until the blob is under the size target (or returns the smallest attempt).
 * The server re-encodes to WebP anyway, so the client format only matters for upload size.
 */
export async function encodeUnderLimit(encode: Encode, maxBytes = MAX_BYTES): Promise<Blob> {
	let type: 'image/webp' | 'image/jpeg' = 'image/webp';
	let blob: Blob | null = null;
	for (const quality of QUALITY_STEPS) {
		blob = await encode(type, quality);
		if (blob && type === 'image/webp' && blob.type !== 'image/webp') {
			type = 'image/jpeg';
			blob = await encode(type, quality);
		}
		if (!blob) throw new Error('Could not encode the image');
		if (blob.size <= maxBytes) break;
	}
	return blob!;
}

export async function compressForUpload(
	source: ImageBitmap | HTMLVideoElement | HTMLCanvasElement
): Promise<Blob> {
	const size = sourceSize(source);
	if (!size.width || !size.height) throw new Error('Image has no dimensions');
	const { width, height } = fitWithin(size.width, size.height, MAX_SIDE);
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas is not supported');
	ctx.drawImage(source, 0, 0, width, height);

	return encodeUnderLimit(
		(type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality))
	);
}
