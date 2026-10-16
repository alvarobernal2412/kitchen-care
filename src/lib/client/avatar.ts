import { compressForUpload } from './compress';

export const AVATAR_SIZE = 512;

/** The centered square inside a width x height image. */
export function squareCrop(width: number, height: number): { sx: number; sy: number; side: number } {
	const side = Math.min(width, height);
	return { sx: Math.floor((width - side) / 2), sy: Math.floor((height - side) / 2), side };
}

/** Center-crops the picked photo to a 512x512 square and compresses it for upload. */
export async function prepareAvatar(file: File): Promise<Blob> {
	const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
	try {
		const { sx, sy, side } = squareCrop(bitmap.width, bitmap.height);
		if (side <= 0) throw new Error('Image has no dimensions');
		const out = Math.min(AVATAR_SIZE, side);
		const canvas = document.createElement('canvas');
		canvas.width = out;
		canvas.height = out;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('Canvas is not supported');
		ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, out, out);
		return await compressForUpload(canvas);
	} finally {
		bitmap.close();
	}
}
