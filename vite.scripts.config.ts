import { defineConfig } from 'vite';

// Bundles the operational scripts (migrate, bootstrap-admin) to plain ESM so the production image
// can run them with `node` without tsx or drizzle-kit. Dependencies stay external (they are in the
// image's production node_modules). Used by the Dockerfile: `vite build -c vite.scripts.config.ts`.
export default defineConfig({
	build: {
		ssr: true,
		outDir: 'build-scripts',
		emptyOutDir: true,
		target: 'node24',
		minify: false,
		rollupOptions: {
			input: { migrate: 'scripts/migrate.ts', 'bootstrap-admin': 'scripts/bootstrap-admin.ts' },
			output: { entryFileNames: '[name].js' }
		}
	}
});
