export type PasswordRule = 'length' | 'upper' | 'lower' | 'digit' | 'symbol';

export const MIN_PASSWORD_LENGTH = 8;

export const RULE_LABELS: Record<PasswordRule, string> = {
	length: `At least ${MIN_PASSWORD_LENGTH} characters`,
	upper: 'An uppercase letter',
	lower: 'A lowercase letter',
	digit: 'A digit',
	symbol: 'A symbol'
};

/** Returns the rules the password does not yet satisfy, in display order. Safe for client and server. */
export function validatePassword(pw: string): { ok: boolean; missing: PasswordRule[] } {
	const missing: PasswordRule[] = [];
	if (pw.length < MIN_PASSWORD_LENGTH) missing.push('length');
	if (!/\p{Lu}/u.test(pw)) missing.push('upper');
	if (!/\p{Ll}/u.test(pw)) missing.push('lower');
	if (!/\d/.test(pw)) missing.push('digit');
	if (!/[^\p{L}\d\s]/u.test(pw)) missing.push('symbol');
	return { ok: missing.length === 0, missing };
}
