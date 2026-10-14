/**
 * Build-time macro: `import { shader } from '../scripts/shader.ts' with { type: 'macro' }` then `shader('shader.wgsl', true)` inlines the
 * WGSL of `src/` with the numeric exports of `src/world.ts` substituted, minified and renamed when `prod` is true. The plugin of the
 * dev server calls it too, the query string reloads `world.ts` so a long-running server never serves stale constants.
 */
import { minifyWgsl, renameWgsl, substituteConstants } from './wgsl.ts';

export async function shader(file: string, prod: boolean) {
	const world = (await import(`../src/world.ts?${Bun.nanoseconds()}`)) as typeof import('../src/world.ts');
	const consts = Object.fromEntries(Object.entries(world).filter((e): e is [string, number] => typeof e[1] == 'number'));
	const source = substituteConstants(await Bun.file(`${import.meta.dir}/../src/${file}`).text(), consts);
	return prod ? renameWgsl(minifyWgsl(source)) : source;
}
