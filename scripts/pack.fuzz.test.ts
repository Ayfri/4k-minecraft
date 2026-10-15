/** Slow (about 15 s), kept out of `bun test` by `bunfig.toml`: `bun run test:fuzz`. */
import { expect, test } from 'bun:test';
import { check, noise } from './lib/page.ts';

const LATIN = Array.from({ length: 256 }, (_, i) => String.fromCharCode(i));
const MARKUP = [...'</xmp>a'];
const HEX = [...'0123456789abcdef'];

/** Inputs aimed at the stream edges, with whether some stream of each fits the `<xmp>` (`check` returns false when none does). */
const TABLE: [string, string, boolean][] = [
	['one char', 'a', true],
	['one dash', '-', true],
	['dash run', '-'.repeat(40), true],
	['arrow run', '->'.repeat(40), true],
	['comment close', '-->', true],
	['xmp close', '</xmp>', true],
	['html close', '</script>', true],
	['carriage returns', 'a\r\nb\rc\n'.repeat(20), true],
	['NUL and C1 bytes', '\0\x80\x81\x9f€\0'.repeat(10), true],
	['all latin1', LATIN.join(''), true],
	['repeated byte', 'x'.repeat(500), true],
];

test.concurrent.each(TABLE)('round trips %s', async (_name, js, fits) => {
	expect(await check(js)).toBe(fits);
}, 120_000);

const SEEDS = Array.from({ length: 6 }, (_, i) => [i + 1] as const);

/** Short markup-heavy inputs make short streams, the likeliest to hold a `</xmp>`. */
test.concurrent.each(SEEDS)('round trips short markup noise, seed %d', async seed => {
	const results = await Promise.all(Array.from({ length: 12 }, (_, i) => check(noise(3 + ((seed + i) % 40), seed * 100 + i, MARKUP))));
	expect(results).toEqual(results.map(() => true));
}, 120_000);

test.concurrent.each(SEEDS)('round trips 2 KB of printable noise, seed %d', async seed => {
	expect(await check(noise(2000, seed))).toBe(true);
}, 120_000);

test.concurrent.each(SEEDS)('round trips 1 KB of latin1 noise, seed %d', async seed => {
	expect(await check(noise(1000, seed, LATIN))).toBe(true);
}, 120_000);

test.concurrent.each(SEEDS)('round trips hex noise, seed %d', async seed => {
	expect(await check(noise(3000, seed, HEX))).toBe(true);
}, 120_000);
