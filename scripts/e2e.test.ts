import { expect, test } from 'bun:test';
import { tmpdir } from 'node:os';

const dir = `${tmpdir()}/claude-temp/4k/e2e`;
const page = `${dir}/index.html`;
const shot = `${dir}/shot.png`;

/** Distinct colors of a screenshot: it is shrunk, quantized to a palette, and the PLTE chunk length is read. A black or uniform frame gives 1. */
async function colors(png: Uint8Array) {
	const small = await new Bun.Image(png).resize(96, 54).png({ colors: 256, palette: true }).bytes();
	const view = new DataView(small.buffer, small.byteOffset);
	for (let at = 8; at < small.length; at += 12 + view.getUint32(at))
		if (String.fromCharCode(...small.subarray(at + 4, at + 8)) === 'PLTE') return view.getUint32(at) / 3;
	return 1;
}

test(
	'the packed page fits 4096 B and renders the landscape from file:// with a clean console',
	async () => {
		await Bun.write(page, Bun.file(`${import.meta.dir}/../dist/index.html`));
		expect(Bun.file(page).size).toBeLessThanOrEqual(4096);
		const report = JSON.parse(await Bun.$`bun ${import.meta.dir}/webview.ts ${page} --wait 2500 --shot ${shot}`.text()) as { console: string[] };
		expect(report.console).toEqual([]);
		expect(await colors(await Bun.file(shot).bytes())).toBeGreaterThan(32);
	},
	120_000,
);
