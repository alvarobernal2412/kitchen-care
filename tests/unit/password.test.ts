import { describe, expect, it } from 'vitest';
import { validatePassword } from '../../src/lib/server/auth/password';

describe('validatePassword', () => {
	it('accepts a password meeting every rule', () => {
		expect(validatePassword('Abcdef1!')).toEqual({ ok: true, missing: [] });
	});
	it('reports a missing uppercase letter', () => {
		const r = validatePassword('abcdefg1!');
		expect(r.ok).toBe(false);
		expect(r.missing).toEqual(['upper']);
	});
	it('reports a too-short password', () => {
		const r = validatePassword('Ab1!');
		expect(r.ok).toBe(false);
		expect(r.missing).toEqual(['length']);
	});
	it('reports missing lowercase, digit and symbol', () => {
		expect(validatePassword('ABCDEFGH').missing).toEqual(['lower', 'digit', 'symbol']);
	});
	it('reports every rule for an empty string', () => {
		expect(validatePassword('').missing).toEqual(['length', 'upper', 'lower', 'digit', 'symbol']);
	});
});
