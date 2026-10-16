import { describe, expect, it } from 'vitest';
import { classify, type SwRequest } from '../../src/lib/sw/routing';

const ORIGIN = 'https://kitchen.example';
const PRECACHED = new Set([
	'/_app/immutable/a.js',
	'/offline/index.html',
	'/manifest.webmanifest',
	'/icons/icon-192.png'
]);

function req(path: string, init: Partial<SwRequest> = {}): SwRequest {
	return {
		method: 'GET',
		mode: 'no-cors',
		url: path.startsWith('http') ? path : ORIGIN + path,
		headers: {},
		...init
	};
}

const cases: [string, SwRequest, 'navigate' | 'asset' | 'bypass'][] = [
	['page navigation', req('/feed', { mode: 'navigate' }), 'navigate'],
	['root navigation', req('/', { mode: 'navigate' }), 'navigate'],
	['navigation to offline page', req('/offline/index.html', { mode: 'navigate' }), 'navigate'],
	['precached build asset', req('/_app/immutable/a.js'), 'asset'],
	['precached static offline page', req('/offline/index.html'), 'asset'],
	['precached manifest', req('/manifest.webmanifest'), 'asset'],
	['precached icon', req('/icons/icon-192.png'), 'asset'],
	['asset not in the precache', req('/_app/immutable/other.js'), 'bypass'],
	['api GET', req('/api/x'), 'bypass'],
	['api navigation', req('/api/x', { mode: 'navigate' }), 'bypass'],
	['media image', req('/media/abc.webp'), 'bypass'],
	['media navigation', req('/media/abc.webp', { mode: 'navigate' }), 'bypass'],
	['data request', req('/x/__data.json'), 'bypass'],
	['root data request', req('/__data.json'), 'bypass'],
	['data request with query', req('/x/__data.json?x-sveltekit-invalidated=01'), 'bypass'],
	['cross-origin model', req('https://storage.googleapis.com/tfjs/model.json'), 'bypass'],
	['cross-origin navigation', req('https://other.example/', { mode: 'navigate' }), 'bypass'],
	['POST', req('/feed', { method: 'POST', mode: 'navigate' }), 'bypass'],
	['POST to asset path', req('/_app/immutable/a.js', { method: 'POST' }), 'bypass'],
	['range request', req('/_app/immutable/a.js', { headers: { range: 'bytes=0-10' } }), 'bypass'],
	['unparsable url', req('http://['), 'bypass']
];

describe('classify', () => {
	for (const [name, request, expected] of cases) {
		it(`${name} -> ${expected}`, () => {
			expect(classify(request, ORIGIN, PRECACHED)).toBe(expected);
		});
	}
});
