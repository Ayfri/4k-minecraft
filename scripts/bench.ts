/** `bench "<command>" [--n 10]` times a command after 1 warm-up (Bun shell, `/` in paths), `--frames n` samples `dbg.bench()`. */
import { parseArgs } from 'node:util';
import { build } from './build.ts';
import { Page } from './webview.ts';

const { positionals, values } = parseArgs({ allowPositionals: true, args: Bun.argv.slice(2).filter(a => a != '--'), options: { frames: { type: 'string' }, n: { type: 'string', default: '10' } } });
const [command] = positionals;
if (!command && !values.frames) throw new Error('usage: bun run bench -- [--n 10] "<command>" | --frames <samples>');

/** `min / median / max / mean ± sd` of `samples` in ms, shown in seconds from 1 s. */
function describe(samples: number[]) {
	const sorted = samples.toSorted((a, b) => a - b);
	const mean = samples.reduce((sum, x) => sum + x, 0) / samples.length;
	const sd = Math.sqrt(samples.reduce((sum, x) => sum + (x - mean) ** 2, 0) / Math.max(samples.length - 1, 1));
	const median = (sorted[(samples.length - 1) >> 1]! + sorted[samples.length >> 1]!) / 2;
	const [unit, scale, digits] = median >= 1000 ? ['s', 1000, 2] : median >= 100 ? ['ms', 1, 0] : median >= 1 ? ['ms', 1, 1] : ['ms', 1, 3];
	const show = (x: number) => (x / scale).toFixed(digits);
	return `n=${samples.length}  min ${show(sorted[0]!)}  median ${show(median)}  max ${show(sorted.at(-1)!)}  mean ${show(mean)} ± ${show(sd)} ${unit}`;
}

/** One untimed warm-up call, then `n` timed ones. */
async function sample(n: number, run: () => Promise<number>) {
	await run();
	const samples: number[] = [];
	for (let i = 0; i < n; i++) samples.push(await run());
	return describe(samples);
}

if (command) {
	console.log(`${command}\n${await sample(Number(values.n), async () => {
		const start = performance.now();
		const { exitCode, stderr } = await Bun.$`${{ raw: command }}`.quiet().nothrow();
		if (exitCode) throw new Error(`exit ${exitCode}: ${stderr.toString().trim()}`);
		return performance.now() - start;
	})}`);
}

if (values.frames) {
	await build(true);
	await using page = await Page.open(`${import.meta.dir}/../dist/dev.html`);
	for (let i = 0; !(await page.view.evaluate('!!globalThis.dbg')); i++) {
		if (i > 100) throw new Error('dbg never appeared on dist/dev.html');
		await Bun.sleep(100);
	}
	console.log(`dbg.bench() ms per frame\n${await sample(Number(values.frames), async () => (await page.view.evaluate('dbg.bench()')) as number)}`);
}
