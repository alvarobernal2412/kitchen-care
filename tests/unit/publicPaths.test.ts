import { describe, expect, it } from 'vitest';
import { isPublicPath } from '../../src/lib/server/publicPaths';

const cases: [string, boolean][] = [
	['/login', true],
	['/login/', true],
	['/signup', true],
	['/privacy', true],
	['/reset-password', true],
	['/logout', true],
	['/healthz', true],
	['/healthz/ready', true],
	['/manifest.webmanifest', true],
	['/service-worker.js', true],
	['/robots.txt', true],
	['/favicon.ico', true],
	['/favicon.png', true],
	['/offline', true],
	['/offline/', true],
	['/icons/icon-192.png', true],
	['/_app/immutable/a.js', true],
	['/_app/version.json', true],
	// Must not match
	['/', false],
	['/loginx', false],
	['/login-admin', false],
	['/login/extra', false],
	['/feed', false],
	['/profile', false],
	['/admin/users', false],
	['/api/x', false],
	['/api/tasks/dishwasher', false],
	['/media/x', false],
	['/media/' + 'a'.repeat(32) + '.webp', false],
	['/_app', false],
	['/_appx/a.js', false],
	['/offlinex', false],
	['/faviconx/../api', false],
	['/icons/../api/x', false],
	['/_app/../api/x', false],
	['/_app/..%2fapi/x', false],
	['/_app/%2e%2e/api/x', false],
	// Case, encoding and slash tricks fail closed
	['/Login', false],
	['/LOGIN', false],
	['/%6Cogin', false],
	['/login%2f', false],
	['//login', false],
	['/login//', false],
	['/_app//a.js', false],
	['', false],
	['login', false]
];

describe('isPublicPath', () => {
	it.each(cases)('%s -> %s', (path, expected) => {
		expect(isPublicPath(path)).toBe(expected);
	});

	it('treats __data.json of a public page as public and of a protected page as protected', () => {
		expect(isPublicPath('/login/__data.json')).toBe(true);
		expect(isPublicPath('/feed/__data.json')).toBe(false);
		expect(isPublicPath('/__data.json')).toBe(false);
	});
});
