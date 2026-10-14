/**
 * Bundles `src/main.ts`. `--dev` writes the readable `dist/dev.html` (DEV hooks on), the default writes the packed
 * `dist/index.html` and prints its size. `--watch` rebuilds on every change under `src`.
 */
import { watch } from 'node:fs';
import { minify } from 'terser';
import * as world from '../src/world.ts';
import { pack } from './pack.ts';
import { minifyWgsl, renameWgsl, substituteConstants } from './wgsl.ts';

const root = `${import.meta.dir}/..`;
const consts = Object.fromEntries(Object.entries(world).filter((e): e is [string, number] => typeof e[1] == 'number'));
const deflated = (s: string) => Bun.deflateSync(s, { level: 12, library: 'libdeflate' }).length;

/** Bundles the game, the WGSL goes through constant substitution and (in prod) minification. */
async function bundle(dev: boolean, emptyWgsl = false) {
	const wgsl = { min: '', source: 0 };
	const result = await Bun.build({
		define: { DEV: String(dev) },
		entrypoints: [`${root}/src/main.ts`],
		format: 'esm',
		plugins: [
			{
				name: 'wgsl',
				setup(b) {
					b.onLoad({ filter: /\.wgsl$/ }, async ({ path }) => {
						const source = await Bun.file(path).text();
						const substituted = substituteConstants(source, consts);
						wgsl.source = source.length;
						wgsl.min = dev ? substituted : renameWgsl(minifyWgsl(substituted));
						return { contents: emptyWgsl ? '' : wgsl.min, loader: 'text' };
					});
				},
			},
		],
		target: 'browser',
	});
	return { code: (await result.outputs[0]!.text()).trim(), wgsl };
}

async function build(dev: boolean) {
	const { code, wgsl } = await bundle(dev);
	if (dev) {
		await Bun.write(`${root}/dist/dev.html`, `<meta charset=utf-8><canvas id=c></canvas><script type=module>${code}</script>`);
		return console.log(`dev build ${new Date().toLocaleTimeString()}, WGSL ${wgsl.source} B`);
	}
	const minified = async (js: string) =>
		(
			await minify(`(async()=>{${js}})()`, {
				compress: { booleans_as_integers: true, keep_fargs: false, passes: 3, pure_getters: true, unsafe: true, unsafe_arrows: true, unsafe_comps: true, unsafe_math: true, unsafe_methods: true },
				ecma: 2022,
				mangle: { reserved: ['c'] },
				module: false,
				toplevel: true,
			})
		).code!;
	const min = await minified(code);
	if (/dbg|console/.test(min)) throw new Error('DEV code leaked into the minified build');
	await Bun.write(`${root}/dist/min.js`, min);
	let packed: Awaited<ReturnType<typeof pack>> | undefined;
	for (const suffix of ['', ';', ' ', ';;']) {
		try {
			packed = await pack(min + suffix);
			break;
		} catch {}
	}
	if (!packed) throw new Error('no suffix gave a stream that fits in an HTML comment');
	await Bun.write(`${root}/dist/index.html`, packed.html);
	const sizeFile = Bun.file(`${root}/dist/size.json`);
	const previous = (await sizeFile.exists()) ? ((await sizeFile.json()) as { deflated: number; page: number }) : undefined;
	await Bun.write(sizeFile, JSON.stringify({ deflated: packed.deflated, page: packed.html.length }));
	const delta = previous ? `, delta ${packed.deflated - previous.deflated >= 0 ? '+' : ''}${packed.deflated - previous.deflated} deflate / ${packed.html.length - previous.page >= 0 ? '+' : ''}${packed.html.length - previous.page} page` : '';
	const jsOnly = deflated((await minified((await bundle(false, true)).code)));
	console.log(
		`WGSL ${wgsl.source} B -> ${wgsl.min.length} B min (${deflated(wgsl.min)} deflated alone), JS ${min.length} B min (${jsOnly} deflated without WGSL), ${packed.codec}, deflate ${packed.deflated} B, page ${packed.html.length} B, ${4096 - packed.html.length} B left${delta}`,
	);
	if (packed.html.length > 4096) process.exit(1);
}

const dev = Bun.argv.includes('--dev');
await build(dev);
if (Bun.argv.includes('--watch')) {
	let timer: Timer | undefined;
	watch(`${root}/src`, { recursive: true }, () => {
		clearTimeout(timer);
		timer = setTimeout(() => build(dev).catch(e => console.error(String(e))), 100);
	});
}
