import type { User } from '$lib/server/auth/users';

declare global {
	namespace App {
		interface Locals {
			user: User | null;
		}
	}
}

export {};
