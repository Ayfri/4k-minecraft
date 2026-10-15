import * as world from '../src/world.ts';
import { cached } from './lib/cache.ts';
import { letToVar, minifyWgsl, renameWgsl, substituteConstants } from './wgsl.ts';

const consts = Object.fromEntries(Object.entries(world).filter((e): e is [string, number] => typeof e[1] == 'number'));
/** Annealing steps of `renameWgsl`, the size gain flattens out past 20000. */
const ROUNDS = 20000;

/** Reads a WGSL file with the numeric exports of `src/world.ts` substituted, then minified, `let` turned to `var` and renamed (seconds of annealing, cached by input). */
export async function shader(path: string) {
	const src = letToVar(minifyWgsl(substituteConstants(await Bun.file(path).text(), consts)));
	return new TextDecoder().decode(await cached('wgsl', ['wgsl.ts'], [`${ROUNDS}`, src], () => new TextEncoder().encode(renameWgsl(src, ROUNDS))));
}
