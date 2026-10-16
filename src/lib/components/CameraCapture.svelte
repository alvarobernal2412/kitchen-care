<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { CameraError, isCameraSupported, startCamera, type CameraSession } from '$lib/client/camera';
	import { compressToWebp } from '$lib/client/compress';

	type Source = ImageBitmap | HTMLCanvasElement;

	let {
		onCapture,
		onCancel,
		detect
	}: {
		onCapture: (blob: Blob, result: { detected: boolean | null }) => void;
		onCancel: () => void;
		detect?: (source: Source) => Promise<boolean>;
	} = $props();

	const supported = isCameraSupported();

	let video: HTMLVideoElement | undefined = $state();
	let session: CameraSession | null = null;
	let phase = $state<'starting' | 'live' | 'processing' | 'review' | 'error'>(
		supported ? 'starting' : 'review'
	);
	let errorCode = $state<string | null>(null);
	let errorMessage = $state('');
	let status = $state('');
	let previewUrl = $state<string | null>(null);
	let blob: Blob | null = null;
	let detected = $state<boolean | null>(null);

	function setError(e: unknown) {
		phase = 'error';
		errorCode = e instanceof CameraError ? e.code : 'unknown';
		errorMessage = e instanceof Error ? e.message : 'Something went wrong';
	}

	async function start() {
		phase = 'starting';
		try {
			session = await startCamera(video!);
			phase = 'live';
		} catch (e) {
			setError(e);
		}
	}

	onMount(() => {
		if (supported) void start();
	});

	function release() {
		session?.stop();
		session = null;
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		previewUrl = null;
	}
	onDestroy(release);

	async function process(source: Source | Blob) {
		phase = 'processing';
		status = 'Processing photo…';
		try {
			let src: Source;
			if (source instanceof Blob) {
				src = await createImageBitmap(source);
			} else {
				src = source;
			}
			blob = await compressToWebp(src);
			detected = null;
			if (detect) {
				status = 'Checking the photo (first time may take a moment)…';
				detected = await detect(src);
			}
			if (previewUrl) URL.revokeObjectURL(previewUrl);
			previewUrl = URL.createObjectURL(blob);
			phase = 'review';
		} catch (e) {
			setError(e);
		}
	}

	async function snap() {
		if (!session) return;
		try {
			const frame = await session.capture();
			session.stop();
			session = null;
			await process(frame);
		} catch (e) {
			setError(e);
		}
	}

	function onFile(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (file) void process(file);
	}

	async function retake() {
		blob = null;
		detected = null;
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		previewUrl = null;
		if (supported) await start();
		else phase = 'review';
	}

	function confirm() {
		if (blob) onCapture(blob, { detected });
	}

	function cancel() {
		release();
		onCancel();
	}
</script>

<div class="overlay" role="dialog" aria-modal="true" aria-label="Take a photo">
	{#if supported}
		<video bind:this={video} class="feed" class:hidden={phase !== 'live'} playsinline muted></video>
	{/if}

	{#if phase === 'review' && !supported && !previewUrl}
		<div class="panel">
			<p>Your browser can't open the camera here. Use your phone's camera to take a photo.</p>
			<label class="btn primary">
				Take photo
				<input type="file" accept="image/*" capture="environment" onchange={onFile} hidden />
			</label>
		</div>
	{:else if phase === 'starting'}
		<div class="panel"><p>Starting camera…</p></div>
	{:else if phase === 'processing'}
		<div class="panel" aria-live="polite"><p>{status}</p></div>
	{:else if phase === 'error'}
		<div class="panel" role="alert">
			{#if errorCode === 'permission-denied'}
				<p>Camera access was blocked. Allow the camera for this site in your browser settings, then try again.</p>
			{:else if errorCode === 'insecure-context'}
				<p>The camera only works on a secure (HTTPS) connection.</p>
			{:else if errorCode === 'no-camera'}
				<p>No camera was found on this device.</p>
			{:else}
				<p>{errorMessage}</p>
			{/if}
			{#if errorCode !== 'insecure-context'}
				<button type="button" class="btn primary" onclick={retake}>Try again</button>
			{/if}
		</div>
	{:else if phase === 'review' && previewUrl}
		<img class="feed" src={previewUrl} alt="Captured preview" />
		{#if detect && detected === false}
			<p class="banner warn" role="alert">No cutlery detected, retake</p>
		{/if}
	{/if}

	<div class="bar">
		<button type="button" class="btn" onclick={cancel}>Cancel</button>
		{#if phase === 'live'}
			<button type="button" class="shutter" aria-label="Take photo" onclick={snap}></button>
		{:else if phase === 'review' && previewUrl}
			<button type="button" class="btn" onclick={retake}>Retake</button>
			<button type="button" class="btn primary" onclick={confirm}>Use photo</button>
		{/if}
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		flex-direction: column;
		background: #000;
		color: #fff;
	}
	.feed {
		flex: 1;
		min-height: 0;
		width: 100%;
		object-fit: contain;
	}
	.hidden {
		display: none;
	}
	.panel {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		padding: 1.5rem;
		text-align: center;
	}
	.banner {
		position: absolute;
		top: 1rem;
		left: 1rem;
		right: 1rem;
		margin: 0;
		padding: 0.75rem 1rem;
		border-radius: 8px;
		font-weight: 600;
		text-align: center;
	}
	.warn {
		background: #d97706;
	}
	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 1rem;
		padding-bottom: calc(1rem + env(safe-area-inset-bottom));
		background: rgba(0, 0, 0, 0.7);
	}
	.btn {
		min-height: 48px;
		min-width: 48px;
		padding: 0 1.25rem;
		border: 1px solid #fff;
		border-radius: 24px;
		background: transparent;
		color: #fff;
		font-size: 1rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
	}
	.btn.primary {
		background: #16a34a;
		border-color: #16a34a;
	}
	.shutter {
		width: 72px;
		height: 72px;
		border-radius: 50%;
		border: 4px solid #fff;
		background: #fff;
		box-shadow: inset 0 0 0 4px #000;
		cursor: pointer;
	}
	.shutter:active {
		transform: scale(0.94);
	}
</style>
