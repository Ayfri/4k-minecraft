import * as world from '../src/world.ts';
import { letToVar, minifyWgsl, substituteConstants } from './wgsl.ts';

const consts = Object.fromEntries(Object.entries(world).filter((e): e is [string, number] => typeof e[1] == 'number'));

/** Reads a WGSL file with the numeric exports of `src/world.ts` substituted, then minified and `let` turned to `var`. The names are chosen later, together with the script's (`chooseNames`). */
export async function shader(path: string) {
	return letToVar(minifyWgsl(substituteConstants(await Bun.file(path).text(), consts)));
}
