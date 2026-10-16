// Creates the first admin from ADMIN_BOOTSTRAP_USERNAME / ADMIN_BOOTSTRAP_PASSWORD (env only,
// never argv, never logged). Runs migrations and task seeding first. Idempotent.
import { eq } from 'drizzle-orm';
import { users } from '../src/lib/server/db/schema';
import { bootstrapAdmin } from '../src/lib/server/db/seed';
import { readBootstrapCredentials } from './bootstrapCredentials';
import { connect, prepareDatabase } from './setupDatabase';

let client: ReturnType<typeof connect>['client'] | undefined;
try {
	const { username, password } = readBootstrapCredentials(process.env);
	const conn = connect();
	client = conn.client;
	await prepareDatabase(conn.db);
	const existing = await conn.db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.usernameNormalized, username.toLowerCase()));
	if (existing.length > 0) {
		console.log(`user "${username}" already exists; nothing changed`);
	} else {
		await bootstrapAdmin(conn.db, username, password);
		console.log(`admin "${username}" created`);
	}
} catch (err) {
	console.error('bootstrap-admin failed:', err instanceof Error ? err.message : err);
	process.exitCode = 1;
} finally {
	await client?.end();
}
