import { shader } from './shader.ts';

/** Loads `.wgsl` imports through `shader()`: `build.ts` passes `prod`, the default export (readable WGSL) is the dev server plugin of `bunfig.toml`. */
export const wgslPlugin = (prod: boolean): Bun.BunPlugin => ({
	name: 'wgsl',
	setup(b) {
		b.onLoad({ filter: /\.wgsl$/ }, async ({ path }) => ({ contents: await shader(path, prod), loader: 'text' }));
	},
});

export default wgslPlugin(false);
