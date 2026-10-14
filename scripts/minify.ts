/** The tuned chain (`minify.best.json`: Closure Compiler, then terser stages with tuned mangler alphabets) competes with fixed terser variants. */
import { tmpdir } from 'node:os';
import { minify, type MinifyOptions } from 'terser';
import { nthIdentifier, stageOptions, type Stage } from './lib/terser-space.ts';
import best from './minify.best.json';
import { pack, type Packed } from './pack.ts';

type Compress = Exclude<NonNullable<MinifyOptions['compress']>, boolean>;

/** The committed chain, `bun run minify:search` rewrites it. */
export const STAGES = best.stages as Stage[];

/** The compress options of the fixed variants, each variant overrides a few of them. */
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

const CLOSURE_PLATFORMS: Record<string, string> = { darwin: 'macos', linux: `linux${process.arch === 'arm64' ? '-arm64' : ''}`, win32: 'windows' };
/** The native binary of `google-closure-compiler`, undefined when its optional platform package is not installed. */
const CLOSURE = (() => {
	try {
		return Bun.resolveSync(`google-closure-compiler-${CLOSURE_PLATFORMS[process.platform]}/compiler${process.platform === 'win32' ? '.exe' : ''}`, import.meta.dir);
	} catch {}
})();
const EXTERNS = `${import.meta.dir}/lib/closure-externs.js`;
let warned = false;

/** Closure Compiler at SIMPLE level, undefined (and one warning) when the binary is missing. `var c` is the canvas, an extern. */
export async function closure(js: string) {
	if (!CLOSURE) {
		if (!warned) console.warn('google-closure-compiler is not installed: the build skips the Closure stage and the page is about 60 B larger.');
		warned = true;
		return undefined;
	}
	const file = `${tmpdir()}/4k-closure-${crypto.randomUUID()}.js`;
	await Bun.write(file, js);
	try {
		const args = ['--js', file, '--externs', EXTERNS, '--compilation_level', 'SIMPLE', '--language_in', 'ECMASCRIPT_NEXT', '--language_out', 'ECMASCRIPT_NEXT', '--warning_level', 'QUIET', '--jscomp_off=undefinedVars'];
		const proc = Bun.spawn([CLOSURE, ...args], { stderr: 'pipe', stdout: 'pipe' });
		const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
		if (code) throw new Error(`closure compiler failed: ${err.slice(0, 400)}`);
		return out.trim();
	} finally {
		await Bun.file(file).delete();
	}
}

interface Variant {
	deflated: number;
	js: string;
	name: string;
}

const deflated = (s: string) => Bun.deflateSync(s, { level: 12, library: 'libdeflate' }).length;
const run = async (js: string, options: MinifyOptions) => (await minify(js, options)).code!;

/** `js` through the terser stages of a chain, the committed ones by default. */
export async function chain(js: string, stages: Stage[] = STAGES) {
	for (const stage of stages) js = await run(js, stageOptions(stage));
	return js;
}

/** Every variant of `wrapped` (the bundle inside its `(async()=>{...})()` wrapper), smallest deflate first. */
async function variants(wrapped: string): Promise<Variant[]> {
	const out = new Map<string, string>();
	const closed = await closure(wrapped);
	out.set(closed ? 'closure > chain' : 'chain', await chain(closed ?? wrapped));
	await Promise.all(Object.entries(TERSER).map(async ([name, options]) => out.set(`terser ${name}`, await run(wrapped, options))));
	const alphabet = STAGES.at(-1)?.alphabet;
	if (alphabet) {
		const top = Object.keys(TERSER).map(name => ({ name, size: deflated(out.get(`terser ${name}`)!) })).sort((a, b) => a.size - b.size).slice(0, 3);
		for (const { name } of top) out.set(`terser ${name} + alphabet`, await run(wrapped, { ...TERSER[name]!, mangle: { reserved: ['c'], ...(TERSER[name]!.mangle as object), nth_identifier: nthIdentifier(alphabet) } }));
	}
	const bunned = await bun(wrapped);
	out.set('bun', bunned);
	out.set('bun > terser', await run(bunned, TERSER.base!));
	out.set('terser > bun', await bun(out.get('terser base')!));
	const distinct = new Map<string, string>();
	for (const [name, js] of out) distinct.set(js, distinct.has(js) ? `${distinct.get(js)}, ${name}` : name);
	return [...distinct].map(([js, name]) => ({ deflated: deflated(js), js, name })).sort((a, b) => a.deflated - b.deflated);
}

/** CR-free streams can still break the comment, a trailing byte changes the stream until one fits. */
export async function packFit(js: string): Promise<Packed> {
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
