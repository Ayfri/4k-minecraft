import { expect, test } from 'bun:test';
import { check, noise } from './lib/page.ts';
import { candidates, encode, pack } from './pack.ts';

test.concurrent.each([
	['a small script', '(async()=>{c.width=1})()'],
	['non-ASCII text', 'const s="é€☃";'],
	['6 KB of noise', noise(6000, 1)],
])('round trips %s', async (_name, js) => {
	expect(await check(js)).toBe(true);
}, 120_000);

const TOKENS = ['let ', 'const ', 'for(', 'i=0;', 'i<n;', 'i++', '){', '}', 'x+=', 'Math.', 'sin(', 'floor(', 'a[i]', '*2', ';', 'return ', 'new ', 'Float32Array(', 'c.width', '=', '1', '0.5', '16'];
/** Seeded token soup, 4 KB of it makes a shortest stream that is not the smallest page (the 7 B gap comes from CR and escape bytes). */
const SOUP = [...noise(1000, 1, TOKENS.map((_, i) => String.fromCharCode(97 + i)))].map(ch => TOKENS[ch.charCodeAt(0) - 97]).join('');

test('picks the candidate with the smallest page, not the shortest stream', async () => {
	const pages = (await candidates(new TextEncoder().encode(SOUP))).map(([codec, stream]) => [codec, encode(stream)?.data.length ?? Infinity] as const);
	const smallest = Math.min(...pages.map(([, size]) => size));
	expect(pages[0]![1]).toBeGreaterThan(smallest);
	const { codec } = await pack(SOUP);
	expect(pages.find(([name]) => name === codec)![1]).toBe(smallest);
}, 120_000);
