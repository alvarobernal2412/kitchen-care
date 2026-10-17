/**
 * Works out how (or whether) this browser can install the app, and the copy to show for it.
 * Pure: it takes plain values, never touches the DOM, and never throws.
 */

export type InstallEnvironment =
	| 'installed'
	| 'ios-safari'
	| 'ios-other-browser'
	| 'ios-inapp'
	| 'mac-safari'
	| 'chromium-prompt'
	| 'unsupported';

export type InstallInput = {
	userAgent: string;
	platform: string;
	maxTouchPoints: number;
	/** navigator.standalone === true, or the (display-mode: standalone) query matches */
	standalone: boolean;
	/** a beforeinstallprompt event is being held */
	hasInstallPromptEvent: boolean;
};

// In-app browsers that cannot add to the Home Screen. Each token is specific to its app.
const IN_APP =
	/\b(Instagram|FBAN|FBAV|FB_IAB|FBIOS|MicroMessenger|WhatsApp|LinkedInApp|Snapchat|Pinterest|TikTok|musical_ly|BytedanceWebview)\b|\bTeams\/|\bLine\/\d|\bTwitter\b/i;
const IOS_OTHER_BROWSER = /\b(CriOS|FxiOS|EdgiOS|OPiOS|OPT)\/\d/;
const MAC_OTHER_BROWSER = /\b(Chrome|Chromium|Edg|OPR|Firefox)\//;

export function detectInstallEnvironment(input: InstallInput): InstallEnvironment {
	try {
		const ua = typeof input.userAgent === 'string' ? input.userAgent : '';
		const platform = typeof input.platform === 'string' ? input.platform : '';
		const touch = Number.isFinite(input.maxTouchPoints) ? input.maxTouchPoints : 0;

		if (input.standalone === true) return 'installed';
		if (input.hasInstallPromptEvent === true) return 'chromium-prompt';
		if (!ua) return 'unsupported';

		const iPhoneLike = /\b(iPhone|iPad|iPod)\b/.test(ua);
		// iPadOS 13+ in desktop mode claims to be a Mac but has a touch screen.
		const iPadDesktop = /\bMacintosh\b/.test(ua) && platform === 'MacIntel' && touch > 1;

		if (iPhoneLike || iPadDesktop) {
			if (IN_APP.test(ua)) return 'ios-inapp';
			if (IOS_OTHER_BROWSER.test(ua)) return 'ios-other-browser';
			// Real Safari has both Version/ and Safari/; a WebView lacks Safari/.
			if (/\bSafari\//.test(ua) && /\bVersion\/\d/.test(ua)) return 'ios-safari';
			if (iPhoneLike && !/\bSafari\//.test(ua) && /AppleWebKit\//.test(ua) && /\bMobile\//.test(ua)) return 'ios-inapp';
			return 'unsupported';
		}

		if (/\bMacintosh\b/.test(ua) && touch === 0) {
			if (MAC_OTHER_BROWSER.test(ua) || !/\bSafari\//.test(ua)) return 'unsupported';
			const m = /\bVersion\/(\d+)/.exec(ua);
			return m && Number(m[1]) >= 17 ? 'mac-safari' : 'unsupported';
		}

		return 'unsupported';
	} catch {
		return 'unsupported';
	}
}

export type InstallInstructions = {
	title: string;
	steps: string[];
	/** an extra line under the steps */
	note?: string;
	/** label of the native install button (chromium-prompt only) */
	button?: string;
};

export function installInstructions(env: InstallEnvironment): InstallInstructions | null {
	switch (env) {
		case 'ios-safari':
			return {
				title: 'Add Kitchen Care to your Home Screen',
				steps: [
					"Tap the Share button in Safari's toolbar.",
					'Scroll down and tap Add to Home Screen.',
					'Tap Add.'
				]
			};
		case 'ios-other-browser':
			return {
				title: 'Add Kitchen Care to your Home Screen',
				steps: ['Tap the Share button.', 'Choose Add to Home Screen.', 'Tap Add.'],
				note: "If you don't see it, open this page in Safari."
			};
		case 'ios-inapp':
			return {
				title: 'Open this page in your browser to install',
				steps: [
					'Tap the menu or the share icon in this app.',
					'Choose Open in Safari (or Open in browser).',
					'Then add it to your Home Screen from there.'
				]
			};
		case 'mac-safari':
			return {
				title: 'Add Kitchen Care to your Dock',
				steps: ['Open the File menu.', 'Choose Add to Dock…', 'Click Add.']
			};
		case 'chromium-prompt':
			return { title: 'Install Kitchen Care', steps: [], button: 'Install app' };
		default:
			return null;
	}
}
