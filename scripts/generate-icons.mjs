// Regenerates the PWA icons in static/icons/ (SVG sources + PNGs). Run: node scripts/generate-icons.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'static', 'icons');
const PLASTER = '#EDF0EB';
const TEAL = '#127A68';

// An enamel-teal tile on plaster holding a coffee cup with a check ("done, credit earned"), drawn
// on a 512x512 canvas. The tile + cup live in one group that is scaled per variant: the maskable
// variant keeps everything inside the central 80% safe circle (tile corners at ~191px of 205px).
const motif = `
	<rect x="106" y="106" width="300" height="300" rx="64" fill="${TEAL}"/>
	<g transform="translate(0 -34)">
		<path d="M196 226h112v50a56 56 0 0 1-56 56h0a56 56 0 0 1-56-56z" fill="${PLASTER}"/>
		<path d="M308 244h10a24 24 0 0 1 0 48h-14" fill="none" stroke="${PLASTER}" stroke-width="14" stroke-linecap="round"/>
		<rect x="176" y="342" width="152" height="12" rx="6" fill="${PLASTER}"/>
		<path d="M230 272l16 16 30-32" fill="none" stroke="${TEAL}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
	</g>`;

function svg({ maskable }) {
	// Any-purpose: rounded plaster tile. Maskable: full-bleed plaster (the OS applies its own mask).
	const bg = maskable
		? `<rect width="512" height="512" fill="${PLASTER}"/>`
		: `<rect width="512" height="512" rx="112" fill="${PLASTER}"/>`;
	const group = maskable
		? `<g transform="translate(256 256) scale(0.9) translate(-256 -256)">${motif}</g>`
		: `<g transform="translate(256 256) scale(1.2) translate(-256 -256)">${motif}</g>`;
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${bg}${group}</svg>
`;
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
await png(maskable.replace('scale(0.9)', 'scale(1)'), 180, 'apple-touch-icon.png');
console.log('Icons written to', OUT);
