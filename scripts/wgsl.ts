/** Strips comments and every space WGSL does not need, keeping `a - -b` and `a + +b` apart so they never lex as `--` or `++`. */
export const minifyWgsl = (s: string) =>
	s
		.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, ' ')
		.replace(/([+\-&])\s+(?=\1)/g, '$1\u0001')
		.replace(/\s*([^\w\s])\s*/g, '$1')
		.replace(/\s+/g, ' ')
		.replace(/\u0001/g, ' ')
		.trim();

const SHORT_RESERVED = new Set(['as', 'do', 'fn', 'if', 'in', 'of']);
const LETTERS = [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'];
const POOL = [...LETTERS, ...LETTERS.flatMap(a => [...LETTERS, ...'0123456789'].map(b => a + b))].filter(n => !SHORT_RESERVED.has(n));
const BUILTIN_ARG = /@(?:builtin|interpolate)\s*\([^)]*\)/g;
const WORD = /(?<![.\w])[A-Za-z_]\w*/g;
const DECLARED = /\b(?:fn|let|const|struct)\s+(\w+)|\bvar(?:<[^>]*>|\s)\s*(\w+)|[(,)]\s*(\w+)\s*:/g;

/** The top-level items (declarations ending at `;` or at their closing brace) of minified WGSL. */
function items(s: string) {
	const out: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < s.length; i++) {
		if (s[i] == '{') depth++;
		if ((s[i] == '}' && !--depth) || (s[i] == ';' && !depth)) out.push(s.slice(start, (start = i + 1)));
	}
	return out;
}

/** Applies `names` to the whole words of `s` that are not members, swizzles or builtin arguments. */
const apply = (s: string, names: Map<string, string>) => s.replace(new RegExp(`${BUILTIN_ARG.source}|${WORD.source}`, 'g'), w => names.get(w) ?? w);

/**
 * Renames every local, parameter and multi-letter global to the first free letter, most used first, except members, swizzles and builtin arguments.
 * A global gets a letter that no function using it spells otherwise, a local a letter that is not a global its function reads,
 * so functions share letters (a local may shadow a global its function never reads).
 */
export function renameWgsl(s: string) {
	const parts = items(s);
	const spelled = (t: string) => new Set(t.replace(BUILTIN_ARG, ' ').match(WORD));
	const members = new Set(s.match(/(?<=\.)\w+/g));
	const declared = (t: string) => [...t.matchAll(DECLARED)].map(m => m[1] ?? m[2] ?? m[3]!);
	const isFn = (t: string) => /^(?:@\w+(?:\([^)]*\))?\s*)*fn\b/.test(t);
	const globals = new Set(parts.map(t => declared(t)[0]).filter((n): n is string => !!n));
	const count = (t: string, n: string) => (t.replace(BUILTIN_ARG, ' ').match(WORD) ?? []).filter(w => w == n).length;
	const pick = (busy: Set<string>) => POOL.find(n => !busy.has(n))!;
	const renamed = new Map<string, string>();
	for (const g of [...globals].filter(n => n.length > 1 && !members.has(n)).sort((a, b) => count(s, b) - count(s, a))) {
		const busy = new Set([...globals, ...renamed.values(), ...parts.filter(t => spelled(t).has(g)).flatMap(t => [...spelled(t)])]);
		renamed.set(g, pick(busy));
	}
	return parts
		.map(t => {
			if (!isFn(t)) return apply(t, renamed);
			const locals = [...new Set(declared(t))].filter(n => !globals.has(n)).sort((a, b) => count(t, b) - count(t, a) || (a < b ? -1 : 1));
			const busy = new Set([...spelled(t)].filter(w => !locals.includes(w)));
			for (const [g, n] of renamed) if (busy.delete(g)) busy.add(n);
			t = apply(t, renamed);
			const names = new Map<string, string>();
			for (const n of locals) busy.add(names.set(n, pick(busy)).get(n)!);
			return apply(t, names);
		})
		.join('');
}

/** Replaces whole-word constant names with their numeric value, as an abstract literal. */
export const substituteConstants = (s: string, consts: Record<string, number>) =>
	s.replace(new RegExp(`\\b(?:${Object.keys(consts).sort((a, b) => b.length - a.length).join('|')})\\b`, 'g'), name => String(consts[name]));
