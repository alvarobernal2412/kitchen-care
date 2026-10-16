// Regenerates the PWA icons in static/icons/ (SVG sources + PNGs). Run: node scripts/generate-icons.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'static', 'icons');
const BRAND = '#1d4ed8';
const SPARK = '#fbbf24';

// A coffee cup with a sparkle ("karma") above it, drawn on a 512x512 canvas. The motif lives
// in a group that the maskable variant scales down so it stays inside the 80% safe zone.
const motif = `
	<path d="M140 232h200v70a100 100 0 0 1-100 100h0a100 100 0 0 1-100-100z" fill="#fff"/>
	<path d="M340 256h14a38 38 0 0 1 0 76h-24" fill="none" stroke="#fff" stroke-width="22" stroke-linecap="round"/>
	<rect x="120" y="416" width="240" height="22" rx="11" fill="#fff"/>
	<path d="M240 84l18 52 52 18-52 18-18 52-18-52-52-18 52-18z" fill="${SPARK}"/>
	<path d="M330 140l7 20 20 7-20 7-7 20-7-20-20-7 20-7z" fill="${SPARK}"/>`;

function svg({ maskable }) {
	// Any-purpose: rounded tile. Maskable: full bleed (the OS applies its own mask), motif at 70%.
	const bg = maskable
		? `<rect width="512" height="512" fill="${BRAND}"/>`
		: `<rect width="512" height="512" rx="112" fill="${BRAND}"/>`;
	const group = maskable
		? `<g transform="translate(256 256) scale(0.7) translate(-240 -266)">${motif}</g>`
		: `<g transform="translate(256 256) scale(0.9) translate(-240 -266)">${motif}</g>`;
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${bg}${group}</svg>\n`;
}

const any = svg({ maskable: false });
const maskable = svg({ maskable: true });

await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, 'icon.svg'), any);
await writeFile(join(OUT, 'icon-maskable.svg'), maskable);

const png = (source, size, name) =>
	sharp(Buffer.from(source), { density: 384 }).resize(size, size).png().toFile(join(OUT, name));

await png(any, 192, 'icon-192.png');
await png(any, 512, 'icon-512.png');
await png(maskable, 512, 'icon-maskable-512.png');
// iOS ignores transparency and masks corners itself, so use the full-bleed version.
await png(maskable.replace('scale(0.7)', 'scale(0.85)'), 180, 'apple-touch-icon.png');
console.log('Icons written to', OUT);
