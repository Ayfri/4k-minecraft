import { expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { Page } from './webview.ts';

const dir = `${tmpdir()}/claude-temp/4k/e2e`;
const dist = `${import.meta.dir}/../dist/index.html`;

/** Distinct colors of a screenshot (shrunk, quantized, PLTE length), 1 for a black or uniform frame. */
async function colors(png: Uint8Array) {
	const small = await new Bun.Image(png).resize(96, 54).png({ colors: 256, palette: true }).bytes();
	const view = new DataView(small.buffer, small.byteOffset);
	for (let at = 8; at < small.length; at += 12 + view.getUint32(at))
		if (String.fromCharCode(...small.subarray(at + 4, at + 8)) === 'PLTE') return view.getUint32(at) / 3;
	return 1;
}

const LIVELY = 32;

/** Opens a page and screenshots it every 100 ms until it shows more than `LIVELY` colors or `timeout` ms pass. */
async function render(file: string, timeout: number) {
	await using page = await Page.open(file);
	const deadline = Date.now() + timeout;
	let count = 0;
	do {
		await Bun.sleep(100);
		count = await colors(await page.view.screenshot({ encoding: 'buffer' }));
	} while (count <= LIVELY && Date.now() < deadline);
	return { colors: count, logs: page.logs };
}

/** One page at a time: two WebViews open together fail with a closed WebSocket (1006), whichever page closes first. */
test('the packed page fits 4096 B and renders the landscape from file:// with a clean console', async () => {
	expect(Bun.file(dist).size).toBeLessThanOrEqual(4096);
	const { colors, logs } = await render(dist, 10_000);
	expect(logs).toEqual([]);
	expect(colors).toBeGreaterThan(LIVELY);
}, 60_000);

test('a black page fails the color check and its console error is reported', async () => {
	await Bun.write(`${dir}/black.html`, '<body style="background:#000"><script>console.error("boom")</script>');
	const { colors, logs } = await render(`${dir}/black.html`, 300);
	expect(colors).toBeLessThanOrEqual(LIVELY);
	expect(logs).toEqual(['[error] boom']);
}, 60_000);
