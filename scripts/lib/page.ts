/** Reads a packed page back like a browser (ISO-8859-15, CR normalized, `<xmp>` raw text to EOF, `onload` run after parsing) and runs its decoder against a fake canvas. */
import { expect } from 'bun:test';
import { pack } from '../pack.ts';

/** WHATWG ISO-8859-15 (label `l9`): identity except these bytes, hardcoded so the tests never trust the runtime's TextDecoder labels. Checked against Chrome 155. */
const L9: Record<number, number> = { 0xa4: 0x20ac, 0xa6: 0x160, 0xa8: 0x161, 0xb4: 0x17d, 0xb8: 0x17e, 0xbc: 0x152, 0xbd: 0x153, 0xbe: 0x178 };

/** The text the HTML parser hands over: ISO-8859-15 decoding, CRLF and lone CR become LF, NUL becomes U+FFFD. */
const parse = (html: Uint8Array) =>
	Array.from(html, b => String.fromCharCode(L9[b] ?? (b || 0xfffd)))
		.join('')
		.replace(/\r\n?/g, '\n');

/** The `<xmp>` text as the parser sees it and what the decoder passes to `eval`, undefined when every stream of `js` closes the `<xmp>`. */
async function roundTrip(js: string) {
	const html = await pack(js, 1).then(
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
