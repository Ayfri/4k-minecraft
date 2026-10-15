import { expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { build } from './build.ts';
import { closure, minifyJs, packFit, terser } from './minify.ts';

const WRAPPED = '(async()=>{const size = 3 * 4;\n\tc.width = size + 1;\n\tc.height = size;\n})()';

/** Runs a script with a fake canvas for the free variable `c`, the wrapper is async so it settles on the next microtask. */
const draw = async (js: string) => {
	const canvas = { height: 0, width: 0 };
	await new Function('c', `return ${js}`)(canvas);
	return canvas;
};

test('packFit gives a page that starts with the charset and the onload decoder and holds the canvas', async () => {
	const { html } = await packFit(WRAPPED);
	const text = new TextDecoder('latin1').decode(html);
	expect(text).toStartWith("<meta charset=l9><body onload='");
	expect(text).toContain("'><canvas id=c><xmp>");
});

test('the pipeline keeps the behavior and the canvas global', async () => {
	expect(await draw(await minifyJs(WRAPPED))).toEqual({ height: 12, width: 13 });
});

test('closure compiles the script and leaves the canvas global alone, or is skipped when it is not installed', async () => {
	const js = await closure(WRAPPED);
	if (js) expect(await draw(js)).toEqual({ height: 12, width: 13 });
	else expect(js).toBeUndefined();
});

test('terser alone, the fallback without Closure, keeps the behavior', async () => {
	expect(await draw(await terser(WRAPPED))).toEqual({ height: 12, width: 13 });
});

test('the build runs the pipeline, the minified game has no DEV code and the page fits', async () => {
	const out = `${tmpdir()}/4k-minify-test-${crypto.randomUUID()}`;
	try {
		await build(false, { out });
		expect(await Bun.file(`${out}/min.js`).text()).not.toMatch(/dbg|console/);
		expect(Bun.file(`${out}/index.html`).size).toBeLessThanOrEqual(4096);
	} finally {
		await Bun.$`rm -rf ${out}`.quiet();
	}
}, 60_000);
