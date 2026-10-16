import { defineConfig } from '@playwright/test';
import { E2E_ORIGIN, E2E_PORT, E2E_UPLOAD_DIR, e2eDatabaseUrl } from './tests/e2e/env';

export default defineConfig({
	testDir: 'tests/e2e',
	globalSetup: './tests/e2e/global-setup.ts',
	workers: 1,
	retries: process.env.CI ? 1 : 0,
	reporter: [['list']],
	// Production build against the dedicated e2e database (created by global-setup.ts).
	// Playwright starts this before global setup; the app connects to the database lazily.
	webServer: {
		command: 'npm run build && node build',
		url: `${E2E_ORIGIN}/login`,
		reuseExistingServer: !process.env.CI,
		timeout: 180_000,
		env: {
			PORT: String(E2E_PORT),
			HOST: '127.0.0.1',
			ORIGIN: E2E_ORIGIN,
			DATABASE_URL: e2eDatabaseUrl(),
			SESSION_SECRET: 'e2e-session-secret-not-for-production',
			UPLOAD_DIR: E2E_UPLOAD_DIR,
			APP_TIMEZONE: 'UTC'
		}
	},
	use: { baseURL: E2E_ORIGIN, trace: 'retain-on-failure' }
});
