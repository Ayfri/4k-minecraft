/** Slow (about a minute), kept out of `bun test` by `bunfig.toml`: `bun run test:fuzz`. */
import { expect, test } from 'bun:test';
import { check, noise } from './lib/page.ts';

const LATIN = Array.from({ length: 256 }, (_, i) => String.fromCharCode(i));
const DASHES = [...'-->a'];
const HEX = [...'0123456789abcdef'];

/** Table of inputs aimed at the stream edges: tiny, empty-ish, dash and `>` heavy, repeated bytes, every byte value. */
const TABLE: [string, string][] = [
	['one char', 'a'],
	['one dash', '-'],
	['dash run', '-'.repeat(40)],
	['arrow run', '->'.repeat(40)],
	['comment close', '-->'],
	['html close', '</script>'],
	['carriage returns', 'a\r\nb\rc\n'.repeat(20)],
	['NUL and C1 bytes', '\0\x80\x81\x9f€\0'.repeat(10)],
	['all latin1', LATIN.join('')],
	['repeated byte', 'x'.repeat(500)],
];

test.concurrent.each(TABLE)('round trips %s', async (_name, js) => {
	await check(js);
}, 120_000);

const SEEDS = Array.from({ length: 6 }, (_, i) => [i + 1] as const);

/** Short dash-heavy inputs make short streams, where a stream starting with `>` or ending with `-` is likeliest. */
test.concurrent.each(SEEDS)('round trips short dash noise, seed %d', async seed => {
	const results = await Promise.all(Array.from({ length: 12 }, (_, i) => check(noise(3 + ((seed + i) % 40), seed * 100 + i, DASHES))));
	expect(results.filter(Boolean).length).toBeGreaterThan(0);
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
