import { describe, expect, it } from 'vitest';
import {
	STALE_AFTER_MS,
	TEST_DB_NAME,
	createdAtOf,
	isStaleTestDb,
	newTestDbName
} from '../helpers/testDbUrl';

const NOW = Date.UTC(2026, 9, 17, 12, 0, 0);

describe('test database names', () => {
	it('accepts only the names the cleanup may drop', () => {
		for (const ok of [
			'kc_test_template',
			'kc_test_template_0a1b2c3d4e5f6a7b8c9',
			'kc_test_0a1b2c3d4e5f',
			'kc_test_a1'
		]) {
			expect(TEST_DB_NAME.test(ok), ok).toBe(true);
		}
		for (const bad of [
			'kitchen',
			'kitchen_e2e',
			'postgres',
			'template1',
			'kc_test_',
			'kc_test_template_',
			'kc_test_template_xyz',
			'kc_test_ABCDEF',
			'kc_test_abc; drop database kitchen',
			'kc_test_abc"',
			'xkc_test_abc',
			'kc_test_abc_def'
		]) {
			expect(TEST_DB_NAME.test(bad), bad).toBe(false);
		}
	});

	it('generated names match the guard and carry their creation time', () => {
		for (const kind of ['template', 'db'] as const) {
			const name = newTestDbName(kind, NOW);
			expect(TEST_DB_NAME.test(name)).toBe(true);
			expect(name.startsWith(kind === 'template' ? 'kc_test_template_' : 'kc_test_')).toBe(true);
			expect(createdAtOf(name)).toBe(NOW);
		}
		expect(newTestDbName('db', NOW)).not.toBe(newTestDbName('db', NOW));
	});

	it('treats only old or unstamped matching names as stale', () => {
		const old = newTestDbName('template', NOW - STALE_AFTER_MS - 1000);
		const young = newTestDbName('template', NOW - 60_000);
		expect(isStaleTestDb(old, NOW)).toBe(true);
		expect(isStaleTestDb(young, NOW)).toBe(false);
		// names from before the creation time was embedded
		expect(isStaleTestDb('kc_test_template', NOW)).toBe(true);
		expect(isStaleTestDb('kc_test_0a1b2c3d4e5f', NOW)).toBe(true);
		// never anything outside the guard, however old
		expect(isStaleTestDb('kitchen', NOW)).toBe(false);
		expect(isStaleTestDb('kitchen_e2e', NOW)).toBe(false);
	});
});
