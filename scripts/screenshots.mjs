#!/usr/bin/env node
/*
 * Full-page screenshots of every screen at 390x844 and 1280x800, light and dark.
 *
 *   node scripts/screenshots.mjs [output-dir]      (default: tmp/screenshots, git-ignored)
 *
 * It runs Playwright with scripts/screenshots/playwright.config.ts: that builds and starts the app
 * against the dedicated e2e database (recreated and seeded like the e2e suite), seeds a believable
 * month of data with the e2e DB helpers, signs in as a seeded member and as the seeded admin, and
 * writes one PNG per screen: <screen>-<light|dark>-<width>.png. Needs the compose.dev.yml Postgres.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(process.argv[2] ?? resolve(root, 'tmp', 'screenshots'));
mkdirSync(outDir, { recursive: true });

const result = spawnSync(
	process.execPath,
	[
		resolve(root, 'node_modules', '@playwright', 'test', 'cli.js'),
		'test',
		'--config',
		resolve(root, 'scripts', 'screenshots', 'playwright.config.ts')
	],
	{ cwd: root, stdio: 'inherit', env: { ...process.env, SCREENSHOT_DIR: outDir } }
);

if (result.status === 0) console.log(`Screenshots written to ${outDir}`);
process.exit(result.status ?? 1);
