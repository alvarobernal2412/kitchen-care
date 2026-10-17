#!/usr/bin/env node
// Runs the full accessibility matrix (both schemes x both viewports for every page, plus the
// 360 px layout check): the same spec as the default run, with A11Y_FULL=1. Works on every OS.
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync(
	process.execPath,
	[resolve(root, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', 'a11y.spec.ts', ...process.argv.slice(2)],
	{ cwd: root, stdio: 'inherit', env: { ...process.env, A11Y_FULL: '1' } }
);
process.exit(result.status ?? 1);
