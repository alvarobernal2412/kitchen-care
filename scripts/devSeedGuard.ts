const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * The demo-data seed deletes and rewrites data, so it only runs against a database on this
 * machine and never with NODE_ENV=production. Throws with a clear message otherwise.
 */
export function assertDevSeedAllowed(env: Record<string, string | undefined>): void {
	if (env.NODE_ENV === 'production') {
		throw new Error('Refusing to seed: NODE_ENV is "production". The demo seed is for local development only.');
	}
	const raw = env.DATABASE_URL?.trim();
	if (!raw) throw new Error('Refusing to seed: DATABASE_URL is not set (copy .env.example to .env).');
	let hostname: string;
	try {
		hostname = new URL(raw).hostname.toLowerCase();
	} catch {
		throw new Error('Refusing to seed: DATABASE_URL is not a valid URL.');
	}
	if (!LOCAL_HOSTS.has(hostname)) {
		throw new Error(
			`Refusing to seed: DATABASE_URL host "${hostname}" is not local. ` +
				'The demo seed only runs against localhost, 127.0.0.1 or ::1.'
		);
	}
}
