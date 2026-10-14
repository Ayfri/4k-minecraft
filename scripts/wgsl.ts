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

/**
 * Renames the declared multi-letter names (functions, `let`/`var`/`const`, structs, parameters) of minified WGSL to the shortest free
 * ones, most used first. A name that is ever read after a `.` (struct member, swizzle) keeps its spelling.
 */
export function renameWgsl(s: string) {
	const tokens = s.match(/(?<![.\w])\w+/g)!;
	const taken = new Set(s.match(/\w+/g));
	const members = new Set(s.match(/(?<=\.)\w+/g));
	const counts = new Map<string, number>();
	for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
	const declared = new Set<string>();
	for (const m of s.matchAll(/\b(?:fn|let|const|struct)\s+(\w+)|\bvar(?:<[^>]*>|\s)\s*(\w+)|[(,)]\s*(\w+)\s*:/g)) declared.add(m[1] ?? m[2] ?? m[3]!);
	const names = [...declared].filter(n => n.length > 1 && !members.has(n)).sort((a, b) => counts.get(b)! - counts.get(a)! || (a < b ? -1 : 1));
	const pool = [...LETTERS, ...LETTERS.flatMap(a => [...LETTERS, ...'0123456789'].map(b => a + b))].filter(n => !taken.has(n) && !SHORT_RESERVED.has(n));
	const renames = new Map(names.map((n, i) => [n, pool[i]!]));
	return s.replace(/@(?:builtin|interpolate)\s*\([^)]*\)|(?<![.\w])[A-Za-z_]\w*/g, w => renames.get(w) ?? w);
}

/** Replaces whole-word constant names with their numeric value, as an abstract literal. */
export const substituteConstants = (s: string, consts: Record<string, number>) =>
	s.replace(new RegExp(`\\b(?:${Object.keys(consts).sort((a, b) => b.length - a.length).join('|')})\\b`, 'g'), name => String(consts[name]));
