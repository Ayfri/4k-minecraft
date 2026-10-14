import { shader } from './shader.ts';

const WORLD = `${import.meta.dir}/../src/world.ts`;

/** Prod inlines `shader()`. Dev exports the readable WGSL with the constants read from the live `world.ts`, since an HMR rebuild never reruns this loader for it. */
export const wgslPlugin = (prod: boolean): Bun.BunPlugin => ({
	name: 'wgsl',
	setup(b) {
		b.onLoad({ filter: /\.wgsl$/ }, async ({ path }) =>
			prod
				? { contents: await shader(path), loader: 'text' }
				: {
						contents: `import*as world from ${JSON.stringify(WORLD)};export default ${JSON.stringify(await Bun.file(path).text())}.replace(/\\b[A-Za-z_]\\w*\\b/g,n=>typeof world[n]=='number'?world[n]:n)`,
						loader: 'js',
					},
		);
	},
});

export default wgslPlugin(false);
