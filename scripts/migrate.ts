// One-shot deploy step: apply migrations and seed tasks. Safe to run repeatedly.
import { connect, prepareDatabase } from './setupDatabase';

const { client, db } = connect();
try {
	await prepareDatabase(db);
	console.log('migrations applied, tasks seeded');
} catch (err) {
	console.error('migrate failed:', err instanceof Error ? err.message : err);
	process.exitCode = 1;
} finally {
	await client.end();
}
