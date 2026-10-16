import { describe, expect, it } from 'vitest';
import { errorCopy } from '../../src/lib/errorCopy';

describe('errorCopy', () => {
	it('maps each status to its fixed copy', () => {
		expect(errorCopy(404).title).toBe("This page doesn't exist");
		expect(errorCopy(403).title).toBe("You don't have access to this page.");
		expect(errorCopy(401).title).toBe('Please log in');
		expect(errorCopy(429).title).toBe('Too many attempts');
		expect(errorCopy(400).title).toBe("That request didn't work");
		expect(errorCopy(418).title).toBe("That request didn't work");
	});

	it('uses the generic server message for every 5xx', () => {
		for (const s of [500, 503]) {
			expect(errorCopy(s).title).toBe('Something went wrong on our side. Try again in a moment.');
		}
	});

	it('offers a log in link only for 401', () => {
		expect(errorCopy(401).offerLogin).toBe(true);
		for (const s of [400, 403, 404, 429, 500, 503, 418]) expect(errorCopy(s).offerLogin).toBe(false);
	});
});
