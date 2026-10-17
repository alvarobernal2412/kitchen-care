/** The configured Postgres (compose.dev.yml default), shared by the global setup and getTestDb(). */
export function testBaseUrl(): URL {
	return new URL(
		process.env.TEST_DATABASE_URL ??
			process.env.DATABASE_URL ??
			'postgres://kitchen:kitchen@localhost:5432/kitchen'
	);
}

/** One fully migrated database per run; every test database is a copy of it. */
export const TEMPLATE_NAME = 'kc_test_template';
