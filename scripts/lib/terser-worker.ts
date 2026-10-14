/** Worker of `minify-search.ts`: `init` loads the script, `eval` runs terser with a config and answers its libdeflate size. */
import { minify } from 'terser';
import { stageOptions, toStage, type Cfg } from './terser-space.ts';

export type Request = { input: string; kind: 'init' } | { cfg: Cfg; id: number; kind: 'eval' };
export interface Response {
	deflated: number;
	hash: string;
	id: number;
	len: number;
}

declare const self: Worker;
let input = '';

self.onmessage = async ({ data }: MessageEvent<Request>) => {
	if (data.kind === 'init') {
		input = data.input;
		return;
	}
	const reply = (r: Omit<Response, 'id'>) => self.postMessage({ ...r, id: data.id } satisfies Response);
	try {
		const code = (await minify(input, stageOptions(toStage(data.cfg)))).code ?? '';
		reply({ deflated: Bun.deflateSync(code, { level: 12, library: 'libdeflate' }).length, hash: Bun.hash(code).toString(36), len: code.length });
	} catch {
		/** Some option mixes make terser throw, they just lose. */
		reply({ deflated: Infinity, hash: 'error', len: 0 });
	}
};
