import { minifyWgsl, renameWgsl, substituteConstants } from './wgsl.ts';

/**
 * Reads a WGSL file with the numeric exports of `src/world.ts` substituted, minified and renamed when `prod`. The query string
 * reloads `world.ts`, so a long-running dev server never serves stale constants.
 */
export async function shader(path: string, prod: boolean) {
	const world = (await import(`../src/world.ts?${Bun.nanoseconds()}`)) as typeof import('../src/world.ts');
	const consts = Object.fromEntries(Object.entries(world).filter((e): e is [string, number] => typeof e[1] == 'number'));
	const source = substituteConstants(await Bun.file(path).text(), consts);
	return prod ? renameWgsl(minifyWgsl(source)) : source;
}
