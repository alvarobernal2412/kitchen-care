import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Bundles scripts/dev-seed.ts to plain ESM for `npm run dev:seed` (development only: it is not
// part of the production image). The seed reuses the app's service functions, some of which
// import through the `$lib` alias, so it is declared here.
export default defineConfig({
	resolve: { alias: { $lib: resolve('src/lib') } },
	build: {
		ssr: true,
		outDir: 'build-scripts-dev',
		emptyOutDir: true,
		target: 'node24',
		minify: false,
		rollupOptions: {
			input: { 'dev-seed': 'scripts/dev-seed.ts' },
			output: { entryFileNames: '[name].js' }
		}
	}
});
