/** Dev server plugin (`[serve.static] plugins` in `bunfig.toml`): serves `src/*.wgsl` as readable text with the constants substituted. */
import { basename } from 'node:path';
import { shader } from './shader.ts';

export default {
	name: 'wgsl',
	setup(b) {
		b.onLoad({ filter: /\.wgsl$/ }, async ({ path }) => ({ contents: await shader(basename(path), false), loader: 'text' }));
	},
} satisfies Bun.BunPlugin;
