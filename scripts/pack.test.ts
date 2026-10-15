import { expect, test } from 'bun:test';
import { build } from './build.ts';
import { hopeless } from './lib/deflate.ts';
import { check, noise, variants } from './lib/page.ts';
import { search } from './lib/pool.ts';
import { candidates, encode, FORBIDDEN, pack, render, SUFFIXES } from './pack.ts';

test.concurrent.each([
	['a small script', '(async()=>{c.width=1})()'],
	['non-ASCII text', 'const s="é€☃";'],
	['6 KB of noise', noise(6000, 1)],
])('round trips %s', async (_name, js) => {
	expect(await check(js)).toBe(true);
}, 300_000);

const TOKENS = ['let ', 'const ', 'for(', 'i=0;', 'i<n;', 'i++', '){', '}', 'x+=', 'Math.', 'sin(', 'floor(', 'a[i]', '*2', ';', 'return ', 'new ', 'Float32Array(', 'c.width', '=', '1', '0.5', '16'];
/** Seeded token soup, 4 KB of it makes a shortest stream that is not the smallest page (the 7 B gap comes from CR and escape bytes). */
const SOUP = [...noise(1000, 1, TOKENS.map((_, i) => String.fromCharCode(97 + i)))].map(ch => TOKENS[ch.charCodeAt(0) - 97]).join('');

test('picks the candidate with the smallest page, not the shortest stream', async () => {
	const pages = (await candidates(new TextEncoder().encode(SOUP))).map(([, stream]) => {
		const encoded = encode(stream);
		return encoded ? render(encoded.data, encoded.escape).length : Infinity;
	});
	const smallest = Math.min(...pages);
	expect(pages[0]).toBeGreaterThan(smallest);
	expect((await pack(SOUP, 1)).html.length).toBeLessThanOrEqual(smallest);
}, 120_000);

test('the search stream avoids CR, NUL and the 8 bytes l9 changes, so its page needs no decoding', async () => {
	const { codec, html } = await pack(SOUP.repeat(2), 1);
	const page = Buffer.from(html).toString('latin1');
	expect(codec).toBe('search');
	expect(page).not.toContain('.replace(');
	expect([...html.subarray(page.indexOf('<xmp>') + 5)].filter(b => [0, 13, 0xa4, 0xa6, 0xa8, 0xb4, 0xb8, 0xbc, 0xbd, 0xbe].includes(b))).toEqual([]);
}, 120_000);

test('2 KB of printable noise is hopeless for the constrained search at once, the game is not', async () => {
	await build(false, { out: `${import.meta.dir}/../.cache/game` });
	const game = new TextEncoder().encode(await Bun.file(`${import.meta.dir}/../.cache/game/min.js`).text());
	expect(hopeless(game, FORBIDDEN)).toBe(false);
	const start = performance.now();
	const noisy = new TextEncoder().encode(noise(2000, 1));
	expect(hopeless(noisy, FORBIDDEN)).toBe(true);
	expect(await search(noisy, FORBIDDEN, 0)).toBeUndefined();
	expect(performance.now() - start).toBeLessThan(5000);
}, 120_000);

/** The literals before the first match leave the constrained search a single path, so a forbidden byte on it used to fail 6 of 10 near-copies of the game. The initial run alone (0 rounds) decides that, with the `SUFFIXES` retries the packer makes. */
test('the constrained search finds a stream for 200 near-copies of the game', async () => {
	await build(false, { out: `${import.meta.dir}/../.cache/game` });
	const copies = variants(await Bun.file(`${import.meta.dir}/../.cache/game/min.js`).text(), 200, 7);
	const found = await Promise.all(
		copies.map(async js => {
			for (const suffix of SUFFIXES) {
				const stream = await search(new TextEncoder().encode(js + suffix), FORBIDDEN, 0, 0);
				if (stream) return { stream, text: js + suffix };
			}
		}),
	);
	expect(found.flatMap((f, i) => (f ? [] : [i]))).toEqual([]);
	for (const { stream, text } of found as { stream: Uint8Array; text: string }[]) {
		expect(stream.some(b => FORBIDDEN.includes(b))).toBe(false);
		expect(new TextDecoder().decode(Bun.inflateSync(Uint8Array.from(stream)))).toBe(text);
	}
}, 600_000);
