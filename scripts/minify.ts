/**
 * Picks the minifier setup that gives the smallest packed page. Every variant is ranked by its libdeflate length (a fast proxy),
 * the best two are then packed for real. `bun run build --rank` prints the ranking.
 */
import { minify, type MinifyOptions } from 'terser';
import { pack, type Packed } from './pack.ts';

type Compress = Exclude<NonNullable<MinifyOptions['compress']>, boolean>;

/** The compress options of the current build, every variant overrides a few of them. */
const BASE: Compress = { booleans_as_integers: true, keep_fargs: false, passes: 3, pure_getters: true, unsafe: true, unsafe_arrows: true, unsafe_comps: true, unsafe_math: true, unsafe_methods: true };

const terser = (compress: Compress | false, mangle: MinifyOptions['mangle'] = {}, format: MinifyOptions['format'] = {}): MinifyOptions => ({
	compress,
	ecma: 2022,
	format,
	mangle: { reserved: ['c'], ...(mangle as object) },
	module: false,
	toplevel: true,
});

const unsafeSet = { unsafe_proto: true, unsafe_regexp: true, unsafe_symbols: true, unsafe_undefined: true };
const TERSER: Record<string, MinifyOptions> = {
	base: terser(BASE),
	'inline-1': terser({ ...BASE, inline: 1 }),
	'inline-2': terser({ ...BASE, inline: 2 }),
	'no-collapse': terser({ ...BASE, collapse_vars: false }),
	'no-comparisons': terser({ ...BASE, comparisons: false }),
	'no-conditionals': terser({ ...BASE, conditionals: false }),
	'no-hoist-props': terser({ ...BASE, hoist_props: false }),
	'no-if-return': terser({ ...BASE, if_return: false }),
	'no-reduce-funcs sequences': terser({ ...BASE, reduce_funcs: false, sequences: false }),
	'no-six': terser({ ...BASE, comparisons: false, conditionals: false, if_return: false, reduce_funcs: false, sequences: false, unsafe_comps: false }),
	'no-join': terser({ ...BASE, join_vars: false }),
	'no-reduce-funcs': terser({ ...BASE, reduce_funcs: false }),
	'no-sequences': terser({ ...BASE, sequences: false }),
	'no-unsafe': terser({ ...BASE, unsafe: false, unsafe_arrows: false, unsafe_comps: false, unsafe_math: false, unsafe_methods: false }),
	'passes-2': terser({ ...BASE, passes: 2 }),
	'passes-5': terser({ ...BASE, passes: 5 }),
	'passes-10': terser({ ...BASE, passes: 10 }),
	'pure-strict': terser({ ...BASE, pure_getters: 'strict' }),
	'unsafe+': terser({ ...BASE, ...unsafeSet }),
	'unsafe+ passes-5': terser({ ...BASE, ...unsafeSet, passes: 5 }),
	'hoist-vars': terser({ ...BASE, hoist_funs: true, hoist_vars: true }),
	'mangle-eval': terser(BASE, { eval: true }),
	'quote-single': terser(BASE, {}, { quote_style: 1 }),
	'quote-double': terser(BASE, {}, { quote_style: 2 }),
	'no-negate-iife': terser({ ...BASE, negate_iife: false }),
	'no-typeofs': terser({ ...BASE, typeofs: false }),
	'ecma-2025': { ...terser(BASE), ecma: 2025 },
	'no-compress-mangle-only': terser(false),
};

/** Bun's minifier on a script, never renames `c` (a free variable inside the wrapper). */
const bun = async (js: string) =>
	(await (await Bun.build({ entrypoints: ['/in.js'], files: { '/in.js': js }, minify: true, target: 'browser' })).outputs[0]!.text()).trim();

interface Variant {
	deflated: number;
	js: string;
	name: string;
}

const deflated = (s: string) => Bun.deflateSync(s, { level: 12, library: 'libdeflate' }).length;
const run = async (js: string, options: MinifyOptions) => (await minify(js, options)).code!;

/** Every variant of `wrapped` (the bundle inside its `(async()=>{...})()` wrapper), smallest deflate first. */
async function variants(wrapped: string): Promise<Variant[]> {
	const out = new Map<string, string>();
	await Promise.all(Object.entries(TERSER).map(async ([name, options]) => out.set(`terser ${name}`, await run(wrapped, options))));
	const bunned = await bun(wrapped);
	out.set('bun', bunned);
	out.set('bun > terser', await run(bunned, TERSER.base!));
	out.set('terser > bun', await bun(out.get('terser base')!));
	const distinct = new Map<string, string>();
	for (const [name, js] of out) distinct.set(js, distinct.has(js) ? `${distinct.get(js)}, ${name}` : name);
	return [...distinct].map(([js, name]) => ({ deflated: deflated(js), js, name })).sort((a, b) => a.deflated - b.deflated);
}

/** CR-free streams can still break the comment, a trailing byte changes the stream until one fits. */
async function packFit(js: string): Promise<Packed> {
	for (const suffix of ['', ';', ' ', ';;']) {
		try {
			return await pack(js + suffix);
		} catch {}
	}
	throw new Error('no suffix gave a stream that fits in an HTML comment');
}

/** The smallest page among the best two proxy-ranked variants. */
export async function bestMinify(wrapped: string) {
	const ranked = await variants(wrapped);
	const finalists = await Promise.all(ranked.slice(0, 2).map(async v => ({ ...v, packed: await packFit(v.js) })));
	const [best] = finalists.sort((a, b) => a.packed.html.length - b.packed.html.length);
	return { best: best!, ranked };
}
