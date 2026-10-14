/** The terser option space searched by `minify-search.ts`, and the `Stage` shape stored in `minify.best.json`. */
import type { MinifyOptions } from 'terser';

/** The 54 letters a mangled name can start with, in the order terser would hand them out. */
export const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ$_';

/** One terser run of the chain: the options as JSON and the mangler alphabet (frequency order of terser when absent). */
export interface Stage {
	alphabet?: string;
	options: MinifyOptions;
}

/** Same arithmetic as terser's `base54` (54 leading letters, then 64 with the digits), but a fixed letter order: `alphabet` first. */
export const nthIdentifier = (alphabet: string) => {
	const chars = alphabet + '0123456789';
	return {
		get(num: number) {
			let name = '';
			let base = 54;
			num++;
			do {
				num--;
				name += chars[num % base];
				num = Math.floor(num / base);
				base = 64;
			} while (num > 0);
			return name;
		},
	};
};

export const stageOptions = ({ alphabet, options }: Stage): MinifyOptions =>
	alphabet ? { ...options, mangle: { ...(options.mangle as object), nth_identifier: nthIdentifier(alphabet) } } : options;

export type Value = boolean | number | string | null;
/** Flat config: `c.` compress, `m.` mangle, `f.` format, bare keys top-level, `alpha` the mangler alphabet. */
export type Cfg = Record<string, Value>;

/** First value is the terser default (null = left unset), the rest are the alternatives tried. */
export const DOMAIN: Record<string, readonly Value[]> = {
	ecma: [2022, 2015, 2017, 2020, 2025],
	module: [false, true],
	toplevel: [true, false],
	'c.arguments': [false, true],
	'c.arrows': [true, false],
	'c.booleans': [true, false],
	'c.booleans_as_integers': [false, true],
	'c.collapse_vars': [true, false],
	'c.comparisons': [true, false],
	'c.computed_props': [true, false],
	'c.conditionals': [true, false],
	'c.dead_code': [true, false],
	'c.directives': [true, false],
	'c.drop_debugger': [true, false],
	'c.ecma': [null, 2015, 2020, 2022, 2025],
	'c.evaluate': [true, false],
	'c.expression': [false, true],
	'c.hoist_funs': [false, true],
	'c.hoist_props': [true, false],
	'c.hoist_vars': [false, true],
	'c.if_return': [true, false],
	'c.inline': [3, 0, 1, 2],
	'c.join_vars': [true, false],
	'c.keep_fargs': [true, false, 'strict'],
	'c.keep_infinity': [false, true],
	'c.lhs_constants': [true, false],
	'c.loops': [true, false],
	'c.negate_iife': [true, false],
	'c.passes': [1, 2, 3, 4, 5, 6, 8, 10],
	'c.properties': [true, false],
	'c.pure_getters': ['strict', true, false],
	'c.pure_new': [false, true],
	'c.reduce_funcs': [true, false],
	'c.reduce_vars': [true, false],
	'c.sequences': [true, false, 5, 30, 1000],
	'c.side_effects': [true, false],
	'c.switches': [true, false],
	'c.toplevel': [null, true, false],
	'c.typeofs': [true, false],
	'c.unsafe': [false, true],
	'c.unsafe_arrows': [false, true],
	'c.unsafe_comps': [false, true],
	'c.unsafe_Function': [false, true],
	'c.unsafe_math': [false, true],
	'c.unsafe_methods': [false, true],
	'c.unsafe_proto': [false, true],
	'c.unsafe_regexp': [false, true],
	'c.unsafe_symbols': [false, true],
	'c.unsafe_undefined': [false, true],
	'c.unused': [true, false],
	'f.ascii_only': [false, true],
	'f.braces': [false, true],
	'f.ecma': [null, 5, 2015, 2022],
	'f.keep_numbers': [false, true],
	'f.quote_keys': [false, true],
	'f.quote_style': [0, 1, 2, 3],
	'f.semicolons': [true, false],
	'f.shorthand': [null, true, false],
	'f.wrap_func_args': [false, true],
	'f.wrap_iife': [false, true],
	'm.eval': [false, true],
	'm.toplevel': [null, true, false],
};

export const KEYS = Object.keys(DOMAIN);

/** Terser defaults plus the options of the former fixed build (`BASE` in `minify.ts`), the starting point of every search. */
export const baseCfg = (): Cfg => ({
	...Object.fromEntries(KEYS.map(k => [k, DOMAIN[k]![0]!])),
	'c.booleans_as_integers': true,
	'c.keep_fargs': false,
	'c.passes': 3,
	'c.pure_getters': true,
	'c.unsafe': true,
	'c.unsafe_arrows': true,
	'c.unsafe_comps': true,
	'c.unsafe_math': true,
	'c.unsafe_methods': true,
});

/** The JSON form of a config, `c` stays reserved because the canvas global is `c`. */
export const toStage = (cfg: Cfg): Stage => {
	const compress: Record<string, Value> = {};
	const mangle: Record<string, Value | string[]> = { reserved: ['c'] };
	const format: Record<string, Value> = {};
	const top: Record<string, Value> = {};
	for (const [key, value] of Object.entries(cfg)) {
		if (value === null || key === 'alpha') continue;
		if (key.startsWith('c.')) compress[key.slice(2)] = value;
		else if (key.startsWith('m.')) mangle[key.slice(2)] = value;
		else if (key.startsWith('f.')) format[key.slice(2)] = value;
		else top[key] = value;
	}
	const alphabet = cfg.alpha;
	return { ...(typeof alphabet === 'string' && { alphabet }), options: { ...top, compress, format, mangle } as MinifyOptions };
};

/** mulberry32 */
export const rng = (seed: number) => () => {
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export type Rand = ReturnType<typeof rng>;
export const pick = <T>(rand: Rand, list: readonly T[]) => list[Math.floor(rand() * list.length)]!;
export const uniform = (rand: Rand): Cfg => Object.fromEntries(KEYS.map(k => [k, pick(rand, DOMAIN[k]!)]));
export const mutate = (rand: Rand, cfg: Cfg, flips: number): Cfg => {
	const next = { ...cfg };
	for (let i = 0; i < flips; i++) {
		const key = pick(rand, KEYS);
		next[key] = pick(rand, DOMAIN[key]!);
	}
	return next;
};
/** Every config one option away from `cfg`. */
export const neighbors = (cfg: Cfg): Cfg[] => KEYS.flatMap(k => DOMAIN[k]!.filter(v => v !== cfg[k]).map(v => ({ ...cfg, [k]: v })));
