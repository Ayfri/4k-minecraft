import * as world from '../src/world.ts';
import { letToVar, minifyWgsl, renameWgsl, substituteConstants } from './wgsl.ts';

const consts = Object.fromEntries(Object.entries(world).filter((e): e is [string, number] => typeof e[1] == 'number'));
const CACHE = `${import.meta.dir}/../.cache/wgsl.json`;
/** Annealing steps of `renameWgsl`, the size gain flattens out past 20000. */
const ROUNDS = 20000;

/** The annealed names take seconds, so the last result is cached by input, annealing steps and `wgsl.ts` itself (the output never depends on the cache). */
async function cached(src: string) {
	const key = String(Bun.hash(`${ROUNDS}${await Bun.file(`${import.meta.dir}/wgsl.ts`).text()}${src}`));
	const file = Bun.file(CACHE);
	const last: { key?: string; out?: string } = (await file.exists()) ? await file.json() : {};
	if (last.key == key) return last.out!;
	const out = renameWgsl(src, ROUNDS);
	await Bun.write(CACHE, JSON.stringify({ key, out }));
	return out;
}

/** Reads a WGSL file with the numeric exports of `src/world.ts` substituted, then minified, `let` turned to `var` and renamed. */
export async function shader(path: string) {
	return cached(letToVar(minifyWgsl(substituteConstants(await Bun.file(path).text(), consts))));
}
