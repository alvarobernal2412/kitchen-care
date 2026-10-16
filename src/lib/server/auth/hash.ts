import { hash, verify } from '@node-rs/argon2';

// argon2id (algorithm 2) with the library's default cost parameters.
export function hashPassword(pw: string): Promise<string> {
	return hash(pw, { algorithm: 2 });
}

export async function verifyPassword(hashed: string, pw: string): Promise<boolean> {
	try {
		return await verify(hashed, pw);
	} catch {
		return false;
	}
}
