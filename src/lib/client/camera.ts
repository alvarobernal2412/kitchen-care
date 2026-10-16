export type CameraErrorCode =
	'permission-denied' | 'no-camera' | 'insecure-context' | 'unsupported' | 'unknown';

export class CameraError extends Error {
	constructor(
		public code: CameraErrorCode,
		message: string
	) {
		super(message);
		this.name = 'CameraError';
	}
}

export function isCameraSupported(): boolean {
	return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

export type CameraSession = {
	stop(): void;
	capture(): Promise<ImageBitmap | HTMLCanvasElement>;
};

export async function startCamera(video: HTMLVideoElement): Promise<CameraSession> {
	if (typeof window !== 'undefined' && window.isSecureContext === false) {
		throw new CameraError('insecure-context', 'The camera needs a secure (HTTPS) connection');
	}
	if (!isCameraSupported()) {
		throw new CameraError('unsupported', 'Camera is not supported in this browser');
	}

	let stream: MediaStream;
	try {
		stream = await navigator.mediaDevices.getUserMedia({
			video: { facingMode: 'environment' },
			audio: false
		});
	} catch (e) {
		const name = (e as DOMException)?.name;
		if (name === 'NotAllowedError' || name === 'SecurityError') {
			throw new CameraError('permission-denied', 'Camera permission was denied');
		}
		if (name === 'NotFoundError' || name === 'OverconstrainedError') {
			throw new CameraError('no-camera', 'No camera was found on this device');
		}
		throw new CameraError('unknown', 'Could not start the camera');
	}

	const stop = () => {
		stream.getTracks().forEach((t) => t.stop());
		video.srcObject = null;
	};

	try {
		video.srcObject = stream;
		video.playsInline = true;
		video.muted = true;
		await video.play();
	} catch {
		stop();
		throw new CameraError('unknown', 'Could not start the camera preview');
	}

	return {
		stop,
		async capture() {
			if (!video.videoWidth || !video.videoHeight) {
				throw new CameraError('unknown', 'Camera is not ready yet');
			}
			if (typeof createImageBitmap === 'function') return createImageBitmap(video);
			const canvas = document.createElement('canvas');
			canvas.width = video.videoWidth;
			canvas.height = video.videoHeight;
			canvas.getContext('2d')!.drawImage(video, 0, 0);
			return canvas;
		}
	};
}
