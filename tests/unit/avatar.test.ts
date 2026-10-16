import { describe, expect, it } from 'vitest';
import { avatarUrl } from '../../src/lib/avatar';

const FILE = 'a'.repeat(32) + '.webp';

describe('avatarUrl', () => {
	it('maps a stored upload name to a /media url', () => {
		expect(avatarUrl(FILE)).toBe(`/media/${FILE}`);
	});
	it.each([
		null,
		undefined,
		'',
		'javascript:alert(1)',
		'../x',
		'http://evil/x.png',
		'/media/' + FILE,
		FILE + '?x=1',
		'A'.repeat(32) + '.webp',
		'abc.webp'
	])('returns null for %s', (v) => {
		expect(avatarUrl(v)).toBeNull();
	});
});
