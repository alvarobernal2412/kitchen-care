import { eq } from 'drizzle-orm';
import type { Db } from './db';
import { users } from './db/schema';

/** Marks onboarding as done. Idempotent. */
export async function completeOnboarding(db: Db, userId: number): Promise<void> {
	await db.update(users).set({ onboardingCompleted: true }).where(eq(users.id, userId));
}
