import { expect, test } from 'bun:test';
import { bestMinify, packFit } from './minify.ts';

const WRAPPED = '(async()=>{const size = 3 * 4;\n\tc.width = size + 1;\n\tc.height = size;\n})()';

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
