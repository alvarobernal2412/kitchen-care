import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';

// The e2e configuration, pointed at the screenshot spec. Paths in a config resolve against the
// config's own folder, so the ones that must stay at the repository root are made absolute.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export default defineConfig({
	...base,
	testDir: resolve(root, 'scripts', 'screenshots'),
	testMatch: 'shots.spec.ts',
	globalSetup: resolve(root, 'tests', 'e2e', 'global-setup.ts'),
	outputDir: resolve(root, 'test-results', 'screenshots'),
	timeout: 120_000,
	webServer: base.webServer && !Array.isArray(base.webServer) ? { ...base.webServer, cwd: root } : base.webServer,
	use: {
		...base.use,
		launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] }
	}
});
