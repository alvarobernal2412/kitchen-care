import { describe, expect, it } from 'vitest';
import { assertDevSeedAllowed } from '../../scripts/devSeedGuard';

const url = (u: string, NODE_ENV?: string) => ({ DATABASE_URL: u, NODE_ENV });

describe('assertDevSeedAllowed', () => {
	it('allows localhost, 127.0.0.1 and ::1', () => {
		expect(() => assertDevSeedAllowed(url('postgres://kitchen:kitchen@localhost:5432/kitchen'))).not.toThrow();
		expect(() => assertDevSeedAllowed(url('postgres://kitchen:kitchen@127.0.0.1:5432/kitchen'))).not.toThrow();
		expect(() => assertDevSeedAllowed(url('postgres://kitchen:kitchen@[::1]:5432/kitchen'))).not.toThrow();
	});

	it('allows an explicit development or test NODE_ENV', () => {
		expect(() => assertDevSeedAllowed(url('postgres://u:p@localhost/db', 'development'))).not.toThrow();
	});

	it('refuses a remote host', () => {
		expect(() => assertDevSeedAllowed(url('postgres://u:p@db.example.com:5432/kitchen'))).toThrow(/not local/);
	});

	it('refuses an empty or missing DATABASE_URL and an invalid one', () => {
		expect(() => assertDevSeedAllowed({})).toThrow(/not set/);
		expect(() => assertDevSeedAllowed(url('   '))).toThrow(/not set/);
		expect(() => assertDevSeedAllowed(url('not a url'))).toThrow(/valid URL/);
	});

	it('is not fooled by credentials that look like a local host', () => {
		expect(() => assertDevSeedAllowed(url('postgres://localhost:secret@evil.example.com/kitchen'))).toThrow(/not local/);
		expect(() => assertDevSeedAllowed(url('postgres://user@127.0.0.1@evil.example.com/kitchen'))).toThrow();
	});

	it('is not fooled by a local name as a prefix or suffix of another host', () => {
		expect(() => assertDevSeedAllowed(url('postgres://u:p@localhost.evil.com/kitchen'))).toThrow(/not local/);
		expect(() => assertDevSeedAllowed(url('postgres://u:p@evil-localhost/kitchen'))).toThrow(/not local/);
		expect(() => assertDevSeedAllowed(url('postgres://u:p@127.0.0.1.nip.io/kitchen'))).toThrow(/not local/);
	});

	it('refuses NODE_ENV=production even for a local database', () => {
		expect(() => assertDevSeedAllowed(url('postgres://u:p@localhost/db', 'production'))).toThrow(/production/);
	});
});
