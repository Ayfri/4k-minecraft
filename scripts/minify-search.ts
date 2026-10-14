/** Re-tunes the chain of `minify.best.json` on the current source (3 to 5 min, all cores), `--samples <n>` per stage, `--seed <n>`, `--dry` writes nothing. */
import { parseArgs } from 'node:util';
import { minify } from 'terser';
import { bundle } from './build.ts';
import { bestMinify, closure, packFit } from './minify.ts';
import { baseCfg, KEYS, LETTERS, mutate, neighbors, pick, rng, stageOptions, toStage, uniform, type Cfg, type Rand, type Stage } from './lib/terser-space.ts';
import type { Request, Response } from './lib/terser-worker.ts';

const { values } = parseArgs({ args: Bun.argv.slice(2).filter(a => a != '--'), options: { dry: { type: 'boolean' }, samples: { type: 'string', default: '2400' }, seed: { type: 'string', default: '1' } } });
const SAMPLES = Number(values.samples);
const rand: Rand = rng(Number(values.seed));
const started = performance.now();
const log = (message: string) => console.log(`${((performance.now() - started) / 1000).toFixed(0).padStart(4)} s  ${message}`);

interface Entry {
	cfg: Cfg;
	deflated: number;
	hash: string;
	len: number;
}

/** One worker per core, each holds the script being tuned. */
class Pool {
	#free: Worker[] = [];
	#id = 0;
	#pending = new Map<number, (r: Response) => void>();
	#waiting: (() => void)[] = [];
	constructor(input: string) {
		for (let i = 0; i < navigator.hardwareConcurrency; i++) {
			const worker = new Worker(`${import.meta.dir}/lib/terser-worker.ts`);
			worker.onmessage = ({ data }: MessageEvent<Response>) => {
				this.#pending.get(data.id)!(data);
				this.#pending.delete(data.id);
				this.#free.push(worker);
				this.#waiting.shift()?.();
			};
			worker.postMessage({ input, kind: 'init' } satisfies Request);
			this.#free.push(worker);
		}
	}
	async eval(cfg: Cfg): Promise<Entry> {
		while (!this.#free.length) await new Promise<void>(resolve => this.#waiting.push(resolve));
		const worker = this.#free.pop()!;
		const id = this.#id++;
		const res = await new Promise<Response>(resolve => {
			this.#pending.set(id, resolve);
			worker.postMessage({ cfg, id, kind: 'eval' } satisfies Request);
		});
		return { cfg, deflated: res.deflated, hash: res.hash, len: res.len };
	}
	close() {
		for (const worker of this.#free) worker.terminate();
	}
}

const better = (a: Entry, b: Entry) => a.deflated - b.deflated || a.len - b.len;

/** Random and mutated samples, steepest descent from the best few, a hill climb on the mangler alphabet, one more descent. Best distinct outputs first. */
async function tune(name: string, input: string, samples: number): Promise<Entry[]> {
	const pool = new Pool(input);
	const seen = new Map<string, Entry>();
	const tried = new Set<string>();
	const evaluate = async (cfgs: Cfg[]) => {
		const fresh = cfgs.filter(c => {
			const key = [...KEYS, 'alpha'].map(k => String(c[k])).join('|');
			return !tried.has(key) && tried.add(key);
		});
		const entries = (await Promise.all(fresh.map(c => pool.eval(c)))).filter(e => e.hash !== 'error');
		for (const e of entries) if (!seen.has(e.hash) || better(e, seen.get(e.hash)!) < 0) seen.set(e.hash, e);
		return entries.sort(better);
	};
	const top = (n: number) => [...seen.values()].sort(better).slice(0, n);
	const descend = async (from: Entry, rounds: number) => {
		let current = from;
		for (let round = 0; round < rounds; round++) {
			const [next] = await evaluate(neighbors(current.cfg));
			if (!next || better(next, current) >= 0) break;
			current = next;
		}
		return current;
	};

	const [base] = await evaluate([baseCfg()]);
	log(`${name}: fixed options ${base!.deflated} B deflated`);
	for (let done = 0; done < samples; done += 600) {
		const best = top(10);
		const batch = Array.from({ length: 600 }, (): Cfg => {
			const r = rand();
			return r < 0.25 ? uniform(rand) : r < 0.5 ? mutate(rand, baseCfg(), 1 + Math.floor(rand() * 7)) : mutate(rand, pick(rand, best).cfg, 1 + Math.floor(rand() * 3));
		});
		await evaluate(batch);
	}
	log(`${name}: random ${top(1)[0]!.deflated} B (${seen.size} distinct outputs)`);
	for (const start of top(4)) await descend(start, 20);
	log(`${name}: descent ${top(1)[0]!.deflated} B`);

	/** Letters by how often the best output uses them, then swaps among the leading positions. */
	const best = top(1)[0]!;
	const frequency = new Map<string, number>();
	for (const char of (await minify(input, stageOptions(toStage(best.cfg)))).code ?? '') frequency.set(char, (frequency.get(char) ?? 0) + 1);
	let climbing = (await evaluate([{ ...best.cfg, alpha: [...LETTERS].sort((a, b) => (frequency.get(b) ?? 0) - (frequency.get(a) ?? 0)).join('') }]))[0]!;
	for (let round = 0; round < 20; round++) {
		const batch = Array.from({ length: 120 }, (): Cfg => {
			const letters = [...(climbing.cfg.alpha as string)];
			for (let swaps = 1 + Math.floor(rand() * 2); swaps > 0; swaps--) {
				const [x, y] = [Math.floor(rand() * 24), Math.floor(rand() * 54)];
				[letters[x], letters[y]] = [letters[y]!, letters[x]!];
			}
			return { ...climbing.cfg, alpha: letters.join('') };
		});
		const [next] = await evaluate(batch);
		if (next && better(next, climbing) < 0) climbing = next;
	}
	log(`${name}: alphabet ${top(1)[0]!.deflated} B`);
	await descend(top(1)[0]!, 10);
	const result = top(4);
	log(`${name}: best ${result[0]!.deflated} B`);
	pool.close();
	return result;
}

const run = async (input: string, cfg: Cfg) => (await minify(input, stageOptions(toStage(cfg)))).code ?? '';
/** Real pages (zopfli) of the finalists of a stage, smallest first. */
const pages = async (finalists: Entry[], source: string, stages: Stage[]) =>
	(await Promise.all(finalists.map(async e => ({ page: (await packFit(await run(source, e.cfg))).html.length, stages: [...stages, toStage(e.cfg)] })))).sort((a, b) => a.page - b.page);

const { code } = await bundle(false);
const wrapped = `(async()=>{${code}})()`;
const { best: current } = await bestMinify(wrapped);
const currentPage = current.packed.html.length;
log(`current build: page ${currentPage} B (${current.name})`);

const closed = await closure(wrapped);
if (!closed) throw new Error('google-closure-compiler is not installed, nothing to tune');
const first = await tune('stage 1', closed, SAMPLES);
const single = await pages(first, closed, []);
log(`closure > terser: page ${single[0]!.page} B`);
const [bestFirst] = first;
const opened = await run(closed, bestFirst!.cfg);
const second = await tune('stage 2', opened, Math.round(SAMPLES / 2));
const double = await pages(second, opened, [toStage(bestFirst!.cfg)]);
log(`closure > terser > terser: page ${double[0]!.page} B`);

/** A second terser stage has to win by more than the 1 to 3 B of zopfli noise, else the shorter chain builds faster and keeps tamer options. */
const winner = double[0]!.page <= single[0]!.page - 4 ? double[0]! : single[0]!;
if (winner!.page < currentPage && !values.dry) {
	await Bun.write(`${import.meta.dir}/minify.best.json`, `${JSON.stringify({ stages: winner!.stages }, null, '\t')}\n`);
	log(`minify.best.json rewritten: ${winner!.stages.length} terser stage(s), page ${currentPage} -> ${winner!.page} B`);
} else {
	log(`minify.best.json kept: tuned page ${winner!.page} B is not below the current ${currentPage} B${values.dry ? ' (dry run)' : ''}`);
}
process.exit(0);
