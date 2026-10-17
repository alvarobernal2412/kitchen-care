<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { CameraError, isCameraSupported, startCamera, type CameraSession } from '$lib/client/camera';
	import { compressForUpload } from '$lib/client/compress';
	import { IconFlag } from '$lib/icons';

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

	let destroyed = false;
	let checkFailed = $state(false);

	async function start() {
		phase = 'starting';
		try {
			const s = await startCamera(video!);
			// The component may have been destroyed while the permission prompt was open.
			if (destroyed) {
				s.stop();
				return;
			}
			session = s;
			phase = 'live';
		} catch (e) {
			if (!destroyed) setError(e);
		}
	}

	// Focus moves into the overlay on open and goes back to whatever opened it on close.
	const opener = typeof document !== 'undefined' ? document.activeElement : null;
	let dialog: HTMLDivElement | undefined = $state();

	onMount(() => {
		dialog?.focus();
		if (supported) void start();
		return () => {
			if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
		};
	});

	function release() {
		session?.stop();
		session = null;
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		previewUrl = null;
	}
	onDestroy(() => {
		destroyed = true;
		release();
	});

	/** Takes ownership of `source` and closes it when done. */
	async function process(source: Source | Blob) {
		phase = 'processing';
		status = 'Processing photo…';
		checkFailed = false;
		let src: Source | null = null;
		try {
			src = source instanceof Blob ? await createImageBitmap(source) : source;
			const out = await compressForUpload(src);
			let result: boolean | null = null;
			if (detect) {
				status = 'Checking the photo (first time may take a moment)…';
				try {
					// coco-ssd fetches its model weights at runtime from a remote host, so any
					// CSP added later must allow that origin (connect-src).
					result = await detect(src);
				} catch {
					// Keep the photo; the parent decides what to do with an unchecked result.
					checkFailed = true;
				}
			}
			if (destroyed) return;
			blob = out;
			detected = result;
			if (previewUrl) URL.revokeObjectURL(previewUrl);
			previewUrl = URL.createObjectURL(out);
			phase = 'review';
		} catch (e) {
			if (!destroyed) setError(e);
		} finally {
			if (typeof ImageBitmap !== 'undefined' && src instanceof ImageBitmap) src.close();
		}
	}

	async function snap() {
		// Take the session synchronously so a double tap is a no-op.
		const s = session;
		if (!s) return;
		session = null;
		try {
			const frame = await s.capture();
			s.stop();
			await process(frame);
		} catch (e) {
			s.stop();
			if (!destroyed) setError(e);
		}
	}

	function onFile(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (file) void process(file);
	}

	async function retake() {
		blob = null;
		detected = null;
		checkFailed = false;
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

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			cancel();
			return;
		}
		if (e.key !== 'Tab' || !dialog) return;
		// Keep Tab inside the overlay.
		const items = [
			...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input[type="file"]')
		];
		if (items.length === 0) {
			e.preventDefault();
			return;
		}
		const first = items[0];
		const last = items[items.length - 1];
		const active = document.activeElement;
		if (e.shiftKey && (active === first || active === dialog)) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && active === last) {
			e.preventDefault();
			first.focus();
		}
	}
</script>

<div
	class="overlay"
	role="dialog"
	aria-modal="true"
	aria-label="Take a photo"
	tabindex="-1"
	bind:this={dialog}
	onkeydown={onKeydown}
>
	{#if supported}
		<video bind:this={video} class="feed" class:hidden={phase !== 'live'} playsinline muted></video>
	{/if}

	{#if phase === 'review' && !supported && !previewUrl}
		<div class="panel">
			<p>Your browser can't open the camera here. Use your phone's camera to take a photo.</p>
			<label class="btn primary file">
				Choose a photo
				<input class="visually-hidden" type="file" accept="image/*" capture="environment" onchange={onFile} />
			</label>
		</div>
	{:else if phase === 'starting'}
		<div class="panel"><p>Starting camera…</p></div>
	{:else if phase === 'processing'}
		<div class="panel" aria-live="polite"><p>{status}</p></div>
	{:else if phase === 'error'}
		<div class="panel" role="alert">
			<div class="error-box">
				{#if errorCode === 'permission-denied'}
					<p>Camera access was blocked. Allow the camera for this site in your browser settings, then try again.</p>
				{:else if errorCode === 'insecure-context'}
					<p>The camera only works on a secure (HTTPS) connection.</p>
				{:else if errorCode === 'no-camera'}
					<p>No camera was found on this device.</p>
				{:else}
					<p>{errorMessage}</p>
				{/if}
			</div>
			<div class="actions">
				{#if errorCode !== 'insecure-context'}
					<button type="button" class="btn primary" onclick={retake}>Try again</button>
				{/if}
				<button type="button" class="btn" onclick={cancel}>Close</button>
			</div>
		</div>
	{:else if phase === 'review' && previewUrl}
		<img class="feed" src={previewUrl} alt="Captured preview" />
		{#if detect && checkFailed}
			<p class="banner" role="alert"><IconFlag size={20} /><span>Couldn't check the photo for cutlery</span></p>
		{:else if detect && detected === false}
			<p class="banner" role="alert"><IconFlag size={20} /><span>No cutlery detected, retake</span></p>
		{/if}
	{/if}

	<div class="bar">
		<button type="button" class="btn" onclick={cancel}>Cancel</button>
		{#if phase === 'live'}
			<button type="button" class="shutter" aria-label="Take photo" onclick={snap}><span></span></button>
		{:else if phase === 'review' && previewUrl}
			<button type="button" class="btn" onclick={retake}>Retake</button>
			<button type="button" class="btn primary" onclick={confirm}>Use photo</button>
		{/if}
	</div>
</div>

<style>
	/* Always dark, whatever the colour scheme: the --cam-* tokens are the same in both. */
	.overlay {
		position: fixed;
		inset: 0;
		z-index: var(--z-overlay);
		display: flex;
		flex-direction: column;
		background: var(--cam-bg);
		color: var(--cam-fg);
		padding-top: env(safe-area-inset-top, 0px);
	}
	.overlay:focus {
		outline: none;
	}
	.overlay :focus-visible {
		outline: 2px solid var(--cam-focus);
		outline-offset: 2px;
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
		gap: var(--sp-4);
		padding: var(--sp-5) var(--gutter);
		text-align: center;
	}
	.panel p {
		max-width: 34ch;
		margin-inline: auto;
		color: var(--cam-fg);
	}
	.error-box {
		padding: var(--sp-4);
		border-radius: var(--r-ctl);
		background: var(--cam-error-bg);
	}
	.error-box p {
		color: var(--cam-error-fg);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--sp-3);
	}
	.banner {
		position: absolute;
		top: calc(var(--sp-4) + env(safe-area-inset-top, 0px));
		left: var(--gutter);
		right: var(--gutter);
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--sp-2);
		margin: 0;
		padding: var(--sp-3) var(--sp-4);
		max-width: none;
		border-radius: var(--r-ctl);
		background: var(--cam-warn-bg);
		color: var(--cam-warn-fg);
		font-weight: 600;
	}
	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-3);
		padding: var(--sp-4) max(var(--gutter), env(safe-area-inset-right, 0px));
		padding-bottom: calc(var(--sp-4) + env(safe-area-inset-bottom, 0px));
		background: var(--cam-bar);
		border-top: 1px solid var(--cam-line);
	}
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 48px;
		min-width: 48px;
		padding: 0 var(--sp-4);
		white-space: nowrap;
		border: 1px solid var(--cam-line);
		border-radius: var(--r-ctl);
		background: transparent;
		color: var(--cam-fg);
		font-size: var(--fs-body);
		font-weight: 600;
		cursor: pointer;
	}
	.btn.primary {
		background: var(--cam-accent);
		border-color: var(--cam-accent);
		color: var(--cam-on-accent);
	}
	.file:focus-within {
		outline: 2px solid var(--cam-focus);
		outline-offset: 2px;
	}
	.shutter {
		display: grid;
		place-items: center;
		width: 72px;
		height: 72px;
		padding: 0;
		border: 3px solid var(--cam-fg);
		border-radius: 50%;
		background: transparent;
		cursor: pointer;
		transition: transform var(--dur-fast) var(--ease-press);
	}
	.shutter span {
		width: 54px;
		height: 54px;
		border-radius: 50%;
		background: var(--cam-fg);
	}
	.shutter:active {
		transform: scale(0.94);
	}
</style>
