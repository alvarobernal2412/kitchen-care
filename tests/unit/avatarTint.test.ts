import { describe, expect, it } from 'vitest';
import { avatarTint } from '../../src/lib/avatarTint';

describe('avatarTint', () => {
	it('is deterministic', () => {
		expect(avatarTint('Ada Lovelace')).toEqual(avatarTint('Ada Lovelace'));
		expect(avatarTint(42)).toEqual(avatarTint(42));
	});
	it('returns matching css variable references from the six-colour palette', () => {
		const t = avatarTint('x');
		expect(t.bg).toMatch(/^var\(--avatar-[1-6]-bg\)$/);
		expect(t.fg).toMatch(/^var\(--avatar-[1-6]-fg\)$/);
		expect(t.bg.match(/\d/)![0]).toBe(t.fg.match(/\d/)![0]);
	});
	it('spreads seeds over the whole palette', () => {
		const strings = new Set<string>();
		for (let i = 0; i < 200; i++) strings.add(avatarTint(`user-${i}`).bg);
		expect(strings.size).toBe(6);
		const numbers = new Set<string>();
		for (let i = 0; i < 60; i++) numbers.add(avatarTint(i).bg);
		expect(numbers.size).toBe(6);
	});
	it.each([
		'',
		-1,
		-123456789,
		NaN,
		Infinity,
		Number.MAX_SAFE_INTEGER,
		1e300,
		'ünïcödé 🍵',
		'a'.repeat(10000)
	])('never throws for %s', (seed) => {
		expect(avatarTint(seed).bg).toMatch(/^var\(--avatar-[1-6]-bg\)$/);
	});
});
