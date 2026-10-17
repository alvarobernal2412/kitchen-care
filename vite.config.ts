import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		include: ['tests/unit/**/*.test.ts'],
		globalSetup: ['tests/globalSetup.ts'],
		// Database tests copy a template database; keep the default pool from spawning one worker per
		// core on big machines. `--maxWorkers` on the command line still overrides this.
		maxWorkers: 4,
		testTimeout: 15_000,
		hookTimeout: 60_000
	}
});
