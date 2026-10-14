/** `--dev` writes the readable `dist/dev.html`, the default the packed `dist/index.html`, `--rank` lists every minifier variant. */
import { bestMinify } from './minify.ts';
import { wgslPlugin } from './wgsl-plugin.ts';

const root = `${import.meta.dir}/..`;

/** The ESM bundle of the game, the WGSL goes through `wgsl-plugin.ts` (minified in prod) and `metafile` lists what each input adds. */
async function bundle(dev: boolean) {
	const result = await Bun.build({
		define: { DEV: String(dev) },
		entrypoints: [`${root}/src/main.ts`],
		format: 'esm',
		metafile: true,
		plugins: [wgslPlugin(!dev)],
		target: 'browser',
	});
	const [output] = Object.values(result.metafile!.outputs);
	return { code: (await result.outputs[0]!.text()).trim(), inputs: output!.inputs };
}

/** Writes `dist/dev.html`, or in prod `dist/min.js`, then the packed `dist/index.html` and `dist/size.json` once the page fits 4096 B (else it throws). */
export async function build(dev: boolean, rank = false) {
	const { code, inputs } = await bundle(dev);
	if (dev) {
		await Bun.write(`${root}/dist/dev.html`, `<meta charset=utf-8><canvas id=c></canvas><script type=module>${code}</script>`);
		return `dev build ${new Date().toLocaleTimeString()}`;
	}
	const { best, ranked } = await bestMinify(`(async()=>{${code}})()`);
	if (/dbg|console/.test(best.js)) throw new Error('DEV code leaked into the minified build');
	const { codec, deflated, html } = best.packed;
	await Bun.write(`${root}/dist/min.js`, best.js);
	const sizeFile = Bun.file(`${root}/dist/size.json`);
	const previous = (await sizeFile.exists()) ? ((await sizeFile.json()) as { deflated: number; page: number }) : undefined;
	const signed = (n: number) => (n >= 0 ? '+' : '') + n;
	const delta = previous ? `, delta ${signed(deflated - previous.deflated)} deflate / ${signed(html.length - previous.page)} page` : '';
	const sources = Object.entries(inputs).map(([path, { bytesInOutput }]) => `${path.split('/').pop()} ${bytesInOutput}`);
	if (rank) for (const v of ranked) console.log(`${String(v.deflated).padStart(5)} deflate, ${String(v.js.length).padStart(5)} B  ${v.name}`);
	const line = `bundle ${sources.join(', ')} B, minified ${best.js.length} B (${best.name}), ${codec}, deflate ${deflated} B, page ${html.length} B, ${4096 - html.length} B left${delta}`;
	if (html.length > 4096) throw new Error(line);
	await Bun.write(`${root}/dist/index.html`, html);
	await Bun.write(sizeFile, JSON.stringify({ deflated, page: html.length }));
	return line;
}

if (import.meta.main) console.log(await build(Bun.argv.includes('--dev'), Bun.argv.includes('--rank')));
