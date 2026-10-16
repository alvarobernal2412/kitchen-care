import { describe, expect, it } from 'vitest';
import { readBootstrapCredentials } from '../../scripts/bootstrapCredentials';

const GOOD = { ADMIN_BOOTSTRAP_USERNAME: 'admin', ADMIN_BOOTSTRAP_PASSWORD: 'Str0ng-Passw0rd!' };

describe('readBootstrapCredentials', () => {
	it('returns trimmed username and the untouched password', () => {
		const creds = readBootstrapCredentials({ ...GOOD, ADMIN_BOOTSTRAP_USERNAME: '  Boss ' });
		expect(creds).toEqual({ username: 'Boss', password: 'Str0ng-Passw0rd!' });
	});

	it('requires both variables', () => {
		expect(() => readBootstrapCredentials({})).toThrow(/ADMIN_BOOTSTRAP_USERNAME/);
		expect(() => readBootstrapCredentials({ ADMIN_BOOTSTRAP_USERNAME: 'admin' })).toThrow(
			/ADMIN_BOOTSTRAP_PASSWORD/
		);
	});

	it('rejects usernames outside the signup length limits', () => {
		expect(() => readBootstrapCredentials({ ...GOOD, ADMIN_BOOTSTRAP_USERNAME: 'ab' })).toThrow(
			/username/i
		);
		expect(() =>
			readBootstrapCredentials({ ...GOOD, ADMIN_BOOTSTRAP_USERNAME: 'a'.repeat(33) })
		).toThrow(/username/i);
	});

	it('applies the password policy and names missing rules without echoing the password', () => {
		let message = '';
		try {
			readBootstrapCredentials({ ...GOOD, ADMIN_BOOTSTRAP_PASSWORD: 'weakpass' });
		} catch (err) {
			message = (err as Error).message;
		}
		expect(message).toMatch(/uppercase/i);
		expect(message).not.toContain('weakpass');
	});
});
