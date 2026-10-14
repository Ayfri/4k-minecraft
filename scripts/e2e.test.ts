import { expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { Page } from './webview.ts';

const dir = `${tmpdir()}/claude-temp/4k/e2e`;
const dist = `${import.meta.dir}/../dist/index.html`;

/** Distinct colors of a screenshot: it is shrunk, quantized to a palette, and the PLTE chunk length is read. A black or uniform frame gives 1. */
async function colors(png: Uint8Array) {
	const small = await new Bun.Image(png).resize(96, 54).png({ colors: 256, palette: true }).bytes();
	const view = new DataView(small.buffer, small.byteOffset);
	for (let at = 8; at < small.length; at += 12 + view.getUint32(at))
		if (String.fromCharCode(...small.subarray(at + 4, at + 8)) === 'PLTE') return view.getUint32(at) / 3;
	return 1;
}

/** Opens a page from file://, waits `wait` ms and returns what the e2e checks look at. */
async function render(file: string, wait: number) {
	await using page = await Page.open(file);
	await Bun.sleep(wait);
	return { colors: await colors(await page.view.screenshot({ encoding: 'buffer' })), logs: page.logs };
}

test.concurrent('the packed page fits 4096 B and renders the landscape from file:// with a clean console', async () => {
	expect(Bun.file(dist).size).toBeLessThanOrEqual(4096);
	const { colors, logs } = await render(dist, 2500);
	expect(logs).toEqual([]);
	expect(colors).toBeGreaterThan(32);
}, 60_000);

test.concurrent('a black page fails the color check and its console error is reported', async () => {
	await Bun.write(`${dir}/black.html`, '<body style="background:#000"><script>console.error("boom")</script>');
	const { colors, logs } = await render(`${dir}/black.html`, 300);
	expect(colors).toBeLessThanOrEqual(32);
	expect(logs).toEqual(['[error] boom']);
}, 60_000);

test.concurrent('an empty page fails the color check', async () => {
	await Bun.write(`${dir}/empty.html`, '');
	expect((await render(`${dir}/empty.html`, 300)).colors).toBeLessThanOrEqual(32);
}, 60_000);
