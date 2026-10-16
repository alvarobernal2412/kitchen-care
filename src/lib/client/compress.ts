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

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
	return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
}

export async function compressToWebp(
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

	let blob: Blob | null = null;
	for (const quality of QUALITY_STEPS) {
		blob = await toBlob(canvas, quality);
		if (!blob || blob.type !== 'image/webp') {
			throw new Error('This browser cannot encode WebP images');
		}
		if (blob.size <= MAX_BYTES) break;
	}
	return blob!;
}
