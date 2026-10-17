import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Playwright cannot emulate a notched device, so this only guards that the pieces are in place.
// Whether the bar really clears the home indicator needs a real iPhone in standalone mode.

const read = (path: string) => readFileSync(path, 'utf8');

/** The declarations of the first rule with this selector in a stylesheet. */
function rule(css: string, selector: string): string {
	const start = css.indexOf(`${selector} {`);
	if (start < 0) throw new Error(`no rule for ${selector}`);
	return css.slice(start, css.indexOf('}', start));
}

describe('safe areas', () => {
	it('lets the page reach under the notch and home indicator', () => {
		expect(read('src/app.html')).toMatch(/name="viewport"[^>]*viewport-fit=cover/);
	});

	it('keeps the bottom tab bar and the content above it clear of the home indicator', () => {
		const shell = read('src/lib/components/AppShell.svelte');
		expect(rule(shell, '.tabbar')).toContain('env(safe-area-inset-bottom');
		expect(rule(shell, '.content')).toContain('env(safe-area-inset-bottom');
	});

	it('keeps the page content inside the side and top insets', () => {
		const body = rule(read('src/lib/styles/base.css'), 'body');
		for (const side of ['top', 'right', 'left']) {
			expect(body).toContain(`env(safe-area-inset-${side}`);
		}
	});
});
