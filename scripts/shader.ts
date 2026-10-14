import * as world from '../src/world.ts';
import { minifyWgsl, renameWgsl, substituteConstants } from './wgsl.ts';

const consts = Object.fromEntries(Object.entries(world).filter((e): e is [string, number] => typeof e[1] == 'number'));

/** Reads a WGSL file with the numeric exports of `src/world.ts` substituted, then minified and renamed. */
export async function shader(path: string) {
	return renameWgsl(minifyWgsl(substituteConstants(await Bun.file(path).text(), consts)));
}
