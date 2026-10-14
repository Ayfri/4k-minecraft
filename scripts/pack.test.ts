import { expect, test } from 'bun:test';
import { pack } from './pack.ts';

/** WHATWG windows-1252 for 0x80-0x9F, hardcoded so the test never trusts the runtime's TextDecoder labels. */
const CP1252 = [
	0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122,
	0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];

/** The text the HTML parser hands over: 1252 decoding, CRLF and lone CR become LF, NUL becomes U+FFFD. */
const parse = (html: Uint8Array) =>
	Array.from(html, b => String.fromCharCode(b >= 0x80 && b < 0xa0 ? CP1252[b - 0x80]! : b || 0xfffd))
		.join('')
		.replace(/\r\n?/g, '\n');

/** Packs `js`, runs the decoder from the parsed page against a fake canvas and returns what it passes to `eval`. */
async function roundTrip(js: string) {
	const { html } = await pack(js);
	const text = parse(html);
	const start = text.indexOf('<!--') + 4;
	const end = text.indexOf('-->', start);
	const comment = text.slice(start, end);
	const script = text.slice(text.indexOf('<script>', end) + 8, text.indexOf('</script>', end));
	expect(comment).not.toContain('--');
	expect(html.includes(13)).toBe(false);
	const decoded = new Promise<string>(resolve => new Function('c', 'eval', script)({ firstChild: { data: comment } }, resolve));
	return { comment, decoded: await decoded, html };
}

/** Seeded printable noise (mulberry32), its deflate stream is dense in CR and escape bytes. */
function noise(length: number, seed: number) {
	let s = seed;
	return Array.from({ length }, () => {
		let t = (s = (s + 0x6d2b79f5) | 0);
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return String.fromCharCode(32 + (((t ^ (t >>> 14)) >>> 0) % 95));
	}).join('');
}

test('round trips a small script', { timeout: 120_000 }, async () => {
	const js = '(async()=>{c.width=1})()';
	expect((await roundTrip(js)).decoded).toBe(js);
});

test('round trips non-ASCII text', { timeout: 120_000 }, async () => {
	const js = 'const s="é€☃";';
	expect((await roundTrip(js)).decoded).toBe(js);
});

for (const seed of [1, 2, 3])
	test(`round trips 6 KB of noise, seed ${seed}`, { timeout: 120_000 }, async () => {
		const js = noise(6000, seed);
		expect((await roundTrip(js)).decoded).toBe(js);
	});
