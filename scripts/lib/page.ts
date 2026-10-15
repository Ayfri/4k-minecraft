/** Reads a packed page back like a browser (windows-1252, CR normalized) and runs its decoder against a fake canvas. */
import { expect } from 'bun:test';
import { pack } from '../pack.ts';

/** WHATWG windows-1252 for 0x80-0x9F, hardcoded so the tests never trust the runtime's TextDecoder labels. */
const CP1252 = [
	0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122,
	0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];

/** The text the HTML parser hands over: 1252 decoding, CRLF and lone CR become LF, NUL becomes U+FFFD. */
const parse = (html: Uint8Array) =>
	Array.from(html, b => String.fromCharCode(b >= 0x80 && b < 0xa0 ? CP1252[b - 0x80]! : b || 0xfffd))
		.join('')
		.replace(/\r\n?/g, '\n');

/** The `<xmp>` text as the parser sees it and what the decoder passes to `eval`, undefined when every stream of `js` closes the `<xmp>`. */
async function roundTrip(js: string) {
	const html = await pack(js).then(
		packed => packed.html,
		e => {
			if (!String(e).includes('closes the xmp')) throw e;
		},
	);
	if (!html) return undefined;
	const text = parse(html);
	const start = text.indexOf("<body onload='") + 14;
	const handler = text.slice(start, text.indexOf("'>", start));
	const raw = text.slice(text.indexOf('<xmp>') + 5);
	const decoded = new Promise<string>(resolve => new Function('c', 'eval', handler)({ textContent: raw }, resolve));
	return { decoded: await decoded, html, raw };
}

/** Holds the packed page to every rule the `<xmp>` and the decoder need, false when every stream of `js` closes the `<xmp>`. */
export async function check(js: string) {
	const trip = await roundTrip(js);
	if (!trip) return false;
	const { decoded, html, raw } = trip;
	expect(raw).not.toMatch(/<\/xmp[\t\n\f />]/i);
	expect(html.includes(13)).toBe(false);
	expect(decoded).toBe(js);
	return true;
}

/** Seeded noise (mulberry32) over `alphabet`, its deflate stream is dense in CR and escape bytes. */
export function noise(length: number, seed: number, alphabet = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i))) {
	let s = seed;
	return Array.from({ length }, () => {
		let t = (s = (s + 0x6d2b79f5) | 0);
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return alphabet[((t ^ (t >>> 14)) >>> 0) % alphabet.length]!;
	}).join('');
}
