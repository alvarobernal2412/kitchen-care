import { detectInstallEnvironment, type InstallEnvironment } from './installHelp';

const KEY = 'kc.install.dismissed';
const HIDE_MS = 30 * 24 * 60 * 60 * 1000;

type PromptEvent = Event & {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

/** Client-only install state. Nothing here runs until start() is called from onMount. */
class InstallState {
	ready = $state(false);
	env = $state<InstallEnvironment>('unsupported');
	dismissedAt = $state<number | null>(null);
	#now = $state(0);
	#event: PromptEvent | null = null;
	#installed = false;
	#started = false;

	get canPromptNatively() {
		return this.env === 'chromium-prompt';
	}

	/** Home banner: hidden for 30 days after "Got it". The Profile section ignores this. */
	get bannerVisible() {
		if (!this.ready || this.env === 'installed' || this.env === 'unsupported') return false;
		return this.dismissedAt === null || this.#now - this.dismissedAt > HIDE_MS;
	}

	#recompute = () => {
		try {
			const standalone =
				(navigator as Navigator & { standalone?: boolean }).standalone === true ||
				window.matchMedia('(display-mode: standalone)').matches;
			this.env = detectInstallEnvironment({
				userAgent: navigator.userAgent,
				platform: navigator.platform,
				maxTouchPoints: navigator.maxTouchPoints,
				standalone: this.#installed || standalone,
				hasInstallPromptEvent: this.#event !== null
			});
		} catch {
			this.env = 'unsupported';
		}
	};

	start() {
		if (this.#started || typeof window === 'undefined') return;
		this.#started = true;
		this.#now = Date.now();
		try {
			const raw = localStorage.getItem(KEY);
			const t = raw ? Date.parse(raw) : NaN;
			this.dismissedAt = Number.isNaN(t) ? null : t;
		} catch {
			/* storage unavailable: works without it */
		}
		window.addEventListener('beforeinstallprompt', (e) => {
			e.preventDefault();
			this.#event = e as PromptEvent;
			this.#recompute();
		});
		window.addEventListener('appinstalled', () => {
			this.#event = null;
			this.#installed = true;
			this.#recompute();
		});
		try {
			window.matchMedia('(display-mode: standalone)').addEventListener('change', this.#recompute);
		} catch {
			/* old engines */
		}
		this.#recompute();
		this.ready = true;
	}

	async promptInstall() {
		const e = this.#event;
		if (!e) return;
		try {
			await e.prompt();
			await e.userChoice;
		} catch {
			/* the browser refused; nothing more to do */
		}
		this.#event = null;
		this.#recompute();
	}

	dismiss() {
		const now = Date.now();
		this.#now = now;
		this.dismissedAt = now;
		try {
			localStorage.setItem(KEY, new Date(now).toISOString());
		} catch {
			/* hidden for this visit only */
		}
	}
}

export const install = new InstallState();
