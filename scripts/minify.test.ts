import { expect, test } from 'bun:test';
import { LETTERS, nthIdentifier } from './lib/terser-space.ts';
import { bestMinify, chain, closure, packFit, STAGES } from './minify.ts';

const WRAPPED = '(async()=>{const size = 3 * 4;\n\tc.width = size + 1;\n\tc.height = size;\n})()';

/** Runs a script with a fake canvas for the free variable `c`, the wrapper is async so it settles on the next microtask. */
const draw = async (js: string) => {
	const canvas = { height: 0, width: 0 };
	await new Function('c', `return ${js}`)(canvas);
	return canvas;
};

test('packFit gives a page that starts with the charset and the canvas', async () => {
	const { html } = await packFit(WRAPPED);
	expect(new TextDecoder('latin1').decode(html.subarray(0, 40))).toStartWith('<meta charset=l1><canvas id=c><!--');
});

test('bestMinify keeps the behavior, ranks by deflate size and returns the smaller page of the best two', async () => {
	const { best, ranked } = await bestMinify(WRAPPED);
	const canvas = { height: 0, width: 0 };
	new Function('c', best.js)(canvas);
	expect(canvas).toEqual({ height: 12, width: 13 });
	expect(ranked.map(v => v.deflated)).toEqual(ranked.map(v => v.deflated).sort((a, b) => a - b));
	expect(ranked.slice(0, 2).map(v => v.js)).toContain(best.js);
	const pages = await Promise.all(ranked.slice(0, 2).map(async v => (await packFit(v.js)).html.length));
	expect(best.packed.html.length).toBe(Math.min(...pages));
});

test('the tuned chain is among the variants and keeps the behavior', async () => {
	const { ranked } = await bestMinify(WRAPPED);
	const variant = ranked.find(v => /chain/.test(v.name));
	expect(variant).toBeDefined();
	expect(await draw(variant!.js)).toEqual({ height: 12, width: 13 });
	expect(await draw(await chain(WRAPPED))).toEqual({ height: 12, width: 13 });
});

test('closure compiles the script and leaves the canvas global alone, or is skipped when it is not installed', async () => {
	const js = await closure(WRAPPED);
	if (js) expect(await draw(js)).toEqual({ height: 12, width: 13 });
	else expect(js).toBeUndefined();
});

test('the mangler alphabet hands out its letters in order, then pairs', () => {
	const names = nthIdentifier(LETTERS);
	expect([0, 1, 53, 54, 55].map(names.get)).toEqual(['a', 'b', '_', 'aa', 'ba']);
	expect(nthIdentifier([...LETTERS].reverse().join('')).get(0)).toBe('_');
});

test('every committed stage is a terser run that keeps `c` and orders all 54 leading letters', () => {
	for (const { alphabet, options } of STAGES) {
		expect((options.mangle as { reserved: string[] }).reserved).toContain('c');
		if (alphabet) expect([...alphabet].sort().join('')).toBe([...LETTERS].sort().join(''));
	}
});
