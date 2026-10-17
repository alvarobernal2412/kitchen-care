import { sveltekit } from '@sveltejs/kit/vite';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ command, mode }) => {
	// Server code reads settings from `process.env` (DATABASE_URL, SESSION_SECRET, UPLOAD_DIR, ...).
	// `vite dev`/`vite preview` only expose `.env` through SvelteKit's `$env` modules, so copy it into
	// `process.env` for local runs. Variables that are already set in the real environment win, and
	// unit tests (vitest) and production builds are left alone.
	if (command === 'serve' && !process.env.VITEST) {
		for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ''))) {
			if (process.env[key] === undefined) process.env[key] = value;
		}
	}
	return viteConfig;
});

const viteConfig = {
	plugins: [sveltekit()],
	// Dev server only (preview and production builds are unaffected): lets a Cloudflare quick tunnel
	// reach `npm run dev` so a phone can open the app over https (the camera needs a secure context).
	server: { allowedHosts: ['.trycloudflare.com'] },
	test: {
		include: ['tests/unit/**/*.test.ts'],
		globalSetup: ['tests/globalSetup.ts'],
		// Database tests copy a template database; keep the default pool from spawning one worker per
		// core on big machines. `--maxWorkers` on the command line still overrides this.
		maxWorkers: 4,
		testTimeout: 15_000,
		hookTimeout: 60_000
	}
};
