const CUTLERY = new Set(['fork', 'knife', 'spoon']);
const MIN_SCORE = 0.5;

export function hasCutlery(predictions: { class: string; score: number }[]): boolean {
	return predictions.some((p) => CUTLERY.has(p.class) && p.score >= MIN_SCORE);
}

type Model = import('@tensorflow-models/coco-ssd').ObjectDetection;
let modelPromise: Promise<Model> | null = null;

async function loadModel(): Promise<Model> {
	// Dynamic imports keep tfjs (large) out of the initial bundle.
	const tf = await import('@tensorflow/tfjs');
	try {
		if (!(await tf.setBackend('webgl'))) throw new Error('webgl unavailable');
	} catch {
		await tf.setBackend('cpu');
	}
	await tf.ready();
	const cocoSsd = await import('@tensorflow-models/coco-ssd');
	return cocoSsd.load();
}

/** Loads the model once; a failed load is not cached so the next call retries. */
export function loadCutleryModel(): Promise<Model> {
	if (!modelPromise) {
		modelPromise = loadModel().catch((e) => {
			modelPromise = null;
			throw e;
		});
	}
	return modelPromise;
}

export async function detectCutlery(
	input: HTMLVideoElement | ImageBitmap | HTMLCanvasElement
): Promise<boolean> {
	const model = await loadCutleryModel();
	let source: HTMLVideoElement | HTMLCanvasElement;
	if (typeof ImageBitmap !== 'undefined' && input instanceof ImageBitmap) {
		// coco-ssd does not accept ImageBitmap directly
		source = document.createElement('canvas');
		source.width = input.width;
		source.height = input.height;
		source.getContext('2d')!.drawImage(input, 0, 0);
	} else {
		source = input as HTMLVideoElement | HTMLCanvasElement;
	}
	return hasCutlery(await model.detect(source));
}
