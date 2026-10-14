import { shader } from './shader.ts';

const WORLD = `${import.meta.dir}/../src/world.ts`;

/** Dev substitutes the constants from the live `world.ts` at runtime: an HMR rebuild never reruns this loader for the shader. */
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
