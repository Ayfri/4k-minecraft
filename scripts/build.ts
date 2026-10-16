/** `--dev` writes `dev.html` (game plus `src/dev` bot), else the packed `index.html`. `--out <dir>` picks the folder, `--verbose` adds the bundle inputs. */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { cached } from './lib/cache.ts';
import { shrunk } from './lib/pool.ts';
import { pack, type Packed } from './pack.ts';
import { shader } from './shader.ts';
import { wgslPlugin } from './wgsl-plugin.ts';

const root = `${import.meta.dir}/..`;
/** The shader names are annealed in `CHAINS` parallel chains of `ROUNDS` steps (a fixed count whatever the core count, the output depends on it), the smallest script wins. */
const CHAINS = 6;
const ROUNDS = 42000;

interface BuildOptions {
	/** Folder of the artifacts and of the size baseline, `dist` by default. */
	out?: string;
	verbose?: boolean;
}

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

/** `pack(js)` kept as one line `codec deflated` followed by the page. */
async function packed(js: string): Promise<Packed> {
	const bytes = (await cached('pack', ['pack.ts', 'lib/deflate.ts', 'lib/pool.ts', 'lib/pool.worker.ts', 'lib/random.ts'], [js], async () => {
		const { codec, deflated, html } = await pack(js);
		return Buffer.concat([Buffer.from(`${codec} ${deflated}\n`), html]);
	}))!;
	const [codec, deflated] = Buffer.from(bytes.subarray(0, bytes.indexOf(10))).toString().split(' ');
	return { codec: codec!, deflated: Number(deflated), html: bytes.subarray(bytes.indexOf(10) + 1) };
}

/** Writes `dev.html`, or `min.js`, `index.html` and `size.json` once the page fits 4096 B, and returns the one-line summary. */
export async function build(dev: boolean, { out = `${root}/dist`, verbose = false }: BuildOptions = {}) {
	out = resolve(out);
	const { code, inputs } = await bundle(dev);
	if (dev) {
		/** The bot is its own entry: `main.ts` never imports `src/dev`, so the prod graph cannot reach it. */
		const bot = await Bun.build({ entrypoints: [`${root}/src/dev/index.ts`], format: 'esm', target: 'browser' });
		await Bun.write(`${out}/dev.html`, `<meta charset=utf-8><canvas id=c></canvas><script type=module>${code}</script><script type=module>${(await bot.outputs[0]!.text()).trim()}</script>`);
		return `dev build ${new Date().toLocaleTimeString()}`;
	}
	if (Object.entries(inputs).some(([path, { bytesInOutput }]) => /src[\\/]dev[\\/]/.test(path) && bytesInOutput)) throw new Error('DEV module leaked into the build');
	const wrapped = `(async()=>{${code}})()`;
	const src = await shader(`${root}/src/shader.wgsl`);
	const js = new TextDecoder().decode(
		await cached('shrink', ['shrink.ts', 'transform.ts', 'print.ts', 'rename.ts', 'wgsl.ts', 'lib/pool.ts', 'lib/pool.worker.ts', 'lib/random.ts'], [wrapped, `${CHAINS}/${ROUNDS}`], async () => {
			const scripts = await Promise.all(Array.from({ length: CHAINS }, (_, seed) => shrunk(wrapped, { rounds: ROUNDS, seed: seed + 1, src })));
			const size = (s: Uint8Array | undefined) => Bun.deflateSync(Uint8Array.from(s!),{ level: 12, library: 'libdeflate' }).length;
			return scripts.reduce((best, s) => (size(s) < size(best) ? s : best));
		}),
	);
	if (/dbg|console/.test(js)) throw new Error('DEV code leaked into the minified build');
	const { codec, deflated, html } = await packed(js);
	await Bun.write(`${out}/min.js`, js);
	const sizeFile = Bun.file(`${out}/size.json`);
	/** A fresh `--out` folder compares against the committed baseline in `dist`. */
	const baseline = (await sizeFile.exists()) ? sizeFile : Bun.file(`${root}/dist/size.json`);
	const previous = (await baseline.exists()) ? ((await baseline.json()) as { deflated: number; page: number }) : undefined;
	const signed = (n: number) => (n >= 0 ? '+' : '') + n;
	const delta = previous ? `, delta ${signed(deflated - previous.deflated)} deflate / ${signed(html.length - previous.page)} page` : '';
	const line = `page ${html.length} B, ${4096 - html.length} B left, deflate ${deflated} B, minified ${js.length} B, ${codec}${delta}`;
	if (html.length > 4096) throw new Error(line);
	await Bun.write(`${out}/index.html`, html);
	await Bun.write(sizeFile, JSON.stringify({ deflated, page: html.length }));
	/** The README, the about page and llms.txt quote the page size as `N of 4096 bytes`, the about page also in `data-bytes` spans. */
	if (out === resolve(`${root}/dist`))
		for (const file of [`${root}/README.md`, `${out}/about.html`, `${out}/llms.txt`]) {
			const text = await Bun.file(file).text();
			const synced = text.replace(/\d+(?= of 4096 bytes)|(?<=data-bytes>)\d+/g, String(html.length));
			if (synced !== text) await Bun.write(file, synced);
		}
	return verbose ? `${line}\nbundle ${Object.entries(inputs).map(([path, { bytesInOutput }]) => `${path.split('/').pop()} ${bytesInOutput}`).join(', ')} B` : line;
}

if (import.meta.main) {
	const { values } = parseArgs({ args: Bun.argv.slice(2), options: { dev: { type: 'boolean' }, out: { type: 'string' }, verbose: { type: 'boolean' } } });
	console.log(await build(!!values.dev, values));
}
