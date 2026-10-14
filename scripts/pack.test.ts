import { expect, test } from 'bun:test';
import { check, noise } from './lib/page.ts';

test.concurrent.each([
	['a small script', '(async()=>{c.width=1})()'],
	['non-ASCII text', 'const s="é€☃";'],
	['6 KB of noise', noise(6000, 1)],
])('round trips %s', async (_name, js) => {
	expect(await check(js)).toBe(true);
}, 120_000);
