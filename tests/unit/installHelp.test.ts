import { describe, expect, it } from 'vitest';
import {
	detectInstallEnvironment,
	installInstructions,
	type InstallEnvironment,
	type InstallInput
} from '../../src/lib/client/installHelp';

const IPHONE_SAFARI_17 =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPHONE_SAFARI_18 =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1';
const IPHONE_FIREFOX =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15';
const IPHONE_EDGE =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/126.2592.87 Mobile/15E148 Safari/605.1.15';
const IPAD_DESKTOP_MODE =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const MAC_SAFARI_17 = IPAD_DESKTOP_MODE;
const MAC_SAFARI_16 =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15';
const MAC_CHROME =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const ANDROID_CHROME =
	'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.122 Mobile Safari/537.36';
const WIN_CHROME =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const WIN_FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0';
const IPHONE_INSTAGRAM =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 335.0.0.37.89 (iPhone14,5; iOS 17_5; en_US; en; scale=3.00; 1170x2532; 593059562)';
const IPHONE_FACEBOOK =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 [FBAN/FBIOS;FBAV/470.0.0.40.108;FBBV/600000000;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]';
const IPHONE_WHATSAPP =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/24.12.76 Safari/604.1';
const IPHONE_TEAMS_WEBVIEW =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Teams/7.8.0';
const IPHONE_BARE_WEBVIEW =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

function env(over: Partial<InstallInput> & { userAgent: string }): InstallEnvironment {
	return detectInstallEnvironment({
		platform: 'iPhone',
		maxTouchPoints: 5,
		standalone: false,
		hasInstallPromptEvent: false,
		...over
	});
}

describe('detectInstallEnvironment', () => {
	it('iPhone Safari 17 and 18', () => {
		expect(env({ userAgent: IPHONE_SAFARI_17 })).toBe('ios-safari');
		expect(env({ userAgent: IPHONE_SAFARI_18 })).toBe('ios-safari');
	});

	it('Chrome, Firefox and Edge on iPhone', () => {
		expect(env({ userAgent: IPHONE_CHROME })).toBe('ios-other-browser');
		expect(env({ userAgent: IPHONE_FIREFOX })).toBe('ios-other-browser');
		expect(env({ userAgent: IPHONE_EDGE })).toBe('ios-other-browser');
	});

	it('iPad Safari in desktop mode is iOS Safari', () => {
		expect(env({ userAgent: IPAD_DESKTOP_MODE, platform: 'MacIntel', maxTouchPoints: 5 })).toBe('ios-safari');
	});

	it('real macOS Safari 17 vs 16', () => {
		expect(env({ userAgent: MAC_SAFARI_17, platform: 'MacIntel', maxTouchPoints: 0 })).toBe('mac-safari');
		expect(env({ userAgent: MAC_SAFARI_16, platform: 'MacIntel', maxTouchPoints: 0 })).toBe('unsupported');
	});

	it('Chrome on a Mac without the event is unsupported', () => {
		expect(env({ userAgent: MAC_CHROME, platform: 'MacIntel', maxTouchPoints: 0 })).toBe('unsupported');
	});

	it('Chromium with the prompt event', () => {
		expect(
			env({ userAgent: ANDROID_CHROME, platform: 'Linux armv81', maxTouchPoints: 5, hasInstallPromptEvent: true })
		).toBe('chromium-prompt');
		expect(
			env({ userAgent: WIN_CHROME, platform: 'Win32', maxTouchPoints: 0, hasInstallPromptEvent: true })
		).toBe('chromium-prompt');
	});

	it('desktop Chrome without the event, and Firefox, are unsupported', () => {
		expect(env({ userAgent: WIN_CHROME, platform: 'Win32', maxTouchPoints: 0 })).toBe('unsupported');
		expect(env({ userAgent: WIN_FIREFOX, platform: 'Win32', maxTouchPoints: 0 })).toBe('unsupported');
	});

	it('in-app browsers on iPhone', () => {
		expect(env({ userAgent: IPHONE_INSTAGRAM })).toBe('ios-inapp');
		expect(env({ userAgent: IPHONE_FACEBOOK })).toBe('ios-inapp');
		expect(env({ userAgent: IPHONE_WHATSAPP })).toBe('ios-inapp');
		expect(env({ userAgent: IPHONE_TEAMS_WEBVIEW })).toBe('ios-inapp');
		expect(env({ userAgent: IPHONE_BARE_WEBVIEW })).toBe('ios-inapp');
	});

	it('standalone wins', () => {
		expect(env({ userAgent: IPHONE_SAFARI_17, standalone: true })).toBe('installed');
		expect(env({ userAgent: WIN_CHROME, standalone: true, hasInstallPromptEvent: true })).toBe('installed');
	});

	it('garbage never throws and is unsupported', () => {
		expect(env({ userAgent: '' })).toBe('unsupported');
		expect(env({ userAgent: 'x'.repeat(5000) })).toBe('unsupported');
		expect(env({ userAgent: 'iPhone' })).toBe('unsupported');
		expect(
			detectInstallEnvironment({
				userAgent: undefined as unknown as string,
				platform: null as unknown as string,
				maxTouchPoints: NaN,
				standalone: false,
				hasInstallPromptEvent: false
			})
		).toBe('unsupported');
	});
});

describe('installInstructions', () => {
	const withSteps: InstallEnvironment[] = ['ios-safari', 'ios-other-browser', 'ios-inapp', 'mac-safari'];

	it('has three plain steps where expected', () => {
		for (const e of withSteps) {
			const h = installInstructions(e);
			expect(h, e).not.toBeNull();
			expect(h!.title.length).toBeGreaterThan(0);
			expect(h!.steps).toHaveLength(3);
		}
	});

	it('has the agreed copy', () => {
		expect(installInstructions('ios-safari')).toEqual({
			title: 'Add Kitchen Care to your Home Screen',
			steps: [
				"Tap the Share button in Safari's toolbar.",
				'Scroll down and tap Add to Home Screen.',
				'Tap Add.'
			]
		});
		expect(installInstructions('ios-other-browser')!.note).toBe("If you don't see it, open this page in Safari.");
		expect(installInstructions('ios-inapp')!.title).toBe('Open this page in your browser to install');
		expect(installInstructions('mac-safari')!.steps[1]).toBe('Choose Add to Dock…');
	});

	it('chromium-prompt has a button and no steps', () => {
		expect(installInstructions('chromium-prompt')).toEqual({
			title: 'Install Kitchen Care',
			steps: [],
			button: 'Install app'
		});
	});

	it('installed and unsupported have no instructions', () => {
		expect(installInstructions('installed')).toBeNull();
		expect(installInstructions('unsupported')).toBeNull();
	});

	it('uses no exclamation marks or emoji', () => {
		const all: InstallEnvironment[] = [...withSteps, 'chromium-prompt'];
		for (const e of all) {
			const h = installInstructions(e)!;
			const text = [h.title, ...h.steps, h.note ?? '', h.button ?? ''].join(' ');
			expect(text).not.toContain('!');
			expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
		}
	});
});
