import { mulberry } from './lib/random.ts';

/** Strips comments and every space WGSL does not need, keeping `a - -b` and `a + +b` apart so they never lex as `--` or `++`. */
export const minifyWgsl = (s: string) =>
	s
		.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, ' ')
		.replace(/([+\-&])\s+(?=\1)/g, '$1\u0001')
		.replace(/\s*([^\w\s])\s*/g, '$1')
		.replace(/\s+/g, ' ')
		.replace(/\u0001/g, ' ')
		.trim();

/** `let` becomes `var` (one keyword, better matches), except where the value may be a pointer, which only a `let` can hold: an initializer starting with `&`, a bare name, or a `ptr<` type. */
export const letToVar = (s: string) => s.replace(/\blet(?=\s+\w+(?::(?!ptr<)[^=;]*)?=(?!&|[A-Za-z_]\w*;))/g, 'var');

const SHORT_RESERVED = new Set(['as', 'do', 'fn', 'if', 'in', 'of']);
const LETTERS = [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'];
const POOL = [...LETTERS, ...LETTERS.flatMap(a => [...LETTERS, ...'0123456789'].map(b => a + b))].filter(n => !SHORT_RESERVED.has(n));
const BUILTIN_ARG = /@(?:builtin|interpolate)\s*\([^)]*\)/g;
const WORD = /(?<![.\w])[A-Za-z_]\w*/g;
const DECLARED = /\b(?:fn|let|var|const|struct)\s+(\w+)|\bvar<[^>]*>\s*(\w+)|[(,)]\s*(\w+)\s*:/g;
const MEMBER_DECL = /[{,](?:@\w+(?:\([^)]*\))?)*(\w+):/g;
const DIRECTIVE = /^(?:enable|requires|diagnostic)\b/;

/** The top-level items (declarations ending at `;` or at their closing brace) of minified WGSL. */
export function items(s: string) {
	const out: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < s.length; i++) {
		if (s[i] == '{') depth++;
		if ((s[i] == '}' && !--depth) || (s[i] == ';' && !depth)) out.push(s.slice(start, (start = i + 1)));
	}
	return out;
}

const declared = (t: string) => [...t.matchAll(DECLARED)].map(m => m[1] ?? m[2] ?? m[3]!);
/** The words a rename can touch, builtin and interpolate arguments included so that they stay aligned. */
const words = (t: string) => t.match(new RegExp(`${BUILTIN_ARG.source}|${WORD.source}`, 'g')) ?? [];

/** An identifier to rename: a global (`item` -1) or a local of the function `item`. Two names that are in scope together never get the same letter. */
class Name {
	readonly conflicts = new Set<Name>();
	readonly itemsUsing = new Set<number>();
	/** Words the names' items spell that are never renamed (keywords, builtins), no letter may equal one. */
	readonly taboo = new Set<string>();
	letter = '';
	uses = 0;

	constructor(
		readonly orig: string,
		readonly item: number,
	) {}

	free(letter: string) {
		return !this.taboo.has(letter) && ![...this.conflicts].some(c => c.letter == letter);
	}
}

/** Item texts as tokens: strings stay, `Name`s take their letter. */
type Tokens = (string | Name)[];

/** Splits the items into tokens and finds, for each name, who it must differ from. Members, swizzles, builtin arguments and struct member declarations are never names. */
function model(parts: string[], s: string) {
	const members = new Set(s.match(/(?<=\.)\w+/g));
	const isFn = (t: string) => /^(?:@\w+(?:\([^)]*\))?\s*)*fn\b/.test(t);
	const globalNames = new Set(parts.map(t => declared(t)[0]).filter((n): n is string => !!n));
	const globals = new Map([...globalNames].filter(n => n.length == 1 || !members.has(n)).map(n => [n, new Name(n, -1)]));
	const re = new RegExp(`${BUILTIN_ARG.source}|${WORD.source}`, 'g');
	const locals: Name[] = [];
	const tokens = parts.map((t, item): Tokens => {
		const own = new Map(isFn(t) ? [...new Set(declared(t))].filter(n => !globalNames.has(n)).map(n => [n, new Name(n, item)]) : []);
		const skip = new Set((t.startsWith('struct') ? [...t.matchAll(MEMBER_DECL)] : []).map(m => m.index! + m[0].length - m[1]!.length - 1));
		const foreign = new Set<string>();
		const out: Tokens = [];
		let last = 0;
		for (const m of t.matchAll(re)) {
			const n = skip.has(m.index!) ? undefined : (own.get(m[0]) ?? globals.get(m[0]));
			if (!n) {
				if (m[0][0] != '@') foreign.add(m[0]);
				continue;
			}
			out.push(t.slice(last, m.index), n);
			n.uses++;
			n.itemsUsing.add(item);
			last = m.index! + m[0].length;
		}
		out.push(t.slice(last));
		const used = new Set(out.filter((x): x is Name => typeof x != 'string'));
		for (const n of used) {
			for (const f of foreign) n.taboo.add(f);
			if (n.item == item) {
				for (const o of used) if (o != n) (n.conflicts.add(o), o.conflicts.add(n));
				locals.push(n);
			}
		}
		return out;
	});
	const all = [...globals.values()];
	for (const a of all) for (const b of all) if (a != b) a.conflicts.add(b);
	return { globals: all, locals: [...new Set(locals)], tokens };
}

/** Throws unless `after` is `before` with consistent, collision-free renaming: per item a word keeps one new name and no two words share one, so no local can capture a global, and a global has one name everywhere. */
export function assertRenamed(before: string[], after: string[]) {
	const globalNames = new Set(before.map(t => declared(t)[0]));
	const global = new Map<string, string>();
	const globalBack = new Map<string, string>();
	before.forEach((t, i) => {
		const was = words(t);
		const now = words(after[i]!);
		if (was.length != now.length) throw new Error(`renaming changed the words of item ${i}`);
		const map = new Map<string, string>();
		const back = new Map<string, string>();
		was.forEach((w, k) => {
			const n = now[k]!;
			if ((map.get(w) ?? n) != n || (back.get(n) ?? w) != w) throw new Error(`renaming ${w} to ${n} is not consistent in item ${i}`);
			map.set(w, n);
			back.set(n, w);
			if (!globalNames.has(w)) return;
			if ((global.get(w) ?? n) != n || (globalBack.get(n) ?? w) != w) throw new Error(`the global ${w} is not renamed to a name of its own (${n})`);
			global.set(w, n);
			globalBack.set(n, w);
		});
	});
}

/** Level 10 is within a byte of level 12 on this script and a third faster, which buys the annealing a third more steps. */
const deflated = (s: string) => Bun.deflateSync(s, { level: 10, library: 'libdeflate' }).length;

/**
 * Renames every local, parameter and multi-letter global to the first free letter, most used first, except members, swizzles and builtin arguments.
 * A global gets a letter no other global has and no word of the items using it spells, a local one that is not a global its function reads,
 * so functions share letters (a local may shadow a global its function never reads).
 * With `rounds`, a seeded annealing then reassigns letters and reorders the declarations to minimise the deflated size of the text,
 * or of `frame`, the script before and after the shader string, with the text in it.
 */
export function renameWgsl(s: string, rounds = 0, frame: [string, string] = ['', ''], seed = 0x9e3779b9) {
	const parts = items(s);
	const { globals, locals, tokens } = model(parts, s);
	for (const g of globals) if (g.orig.length == 1) g.letter = g.orig;
	for (const g of globals.filter(g => !g.letter).sort((a, b) => b.uses - a.uses)) g.letter = POOL.find(l => g.free(l))!;
	for (const fn of new Set(locals.map(l => l.item))) {
		for (const l of locals.filter(l => l.item == fn).sort((a, b) => b.uses - a.uses || (a.orig < b.orig ? -1 : 1))) l.letter = POOL.find(p => l.free(p))!;
	}
	const text = (i: number) => tokens[i]!.map(t => (typeof t == 'string' ? t : t.letter)).join('');
	assertRenamed(parts, parts.map((_, i) => text(i)));
	const names = [...globals, ...locals];
	const pinned = parts.map((t, i) => (DIRECTIVE.test(t) ? i : -1)).filter(i => i >= 0);
	let order = parts.map((_, i) => i);
	if (rounds) {
		const texts = parts.map((_, i) => text(i));
		const render = () => frame[0] + order.map(i => texts[i]).join('') + frame[1];
		const refresh = (n: Name) => n.itemsUsing.forEach(i => (texts[i] = text(i)));
		const next = mulberry(seed);
		const random = () => next() / 2 ** 32;
		const movable = order.filter(i => !pinned.includes(i));
		let current = deflated(render());
		let best = current;
		let bestState = { letters: names.map(n => n.letter), order };
		for (let round = 0; round < rounds; round++) {
			const temperature = 1.5 * (0.05 / 1.5) ** (round / rounds);
			let undo: () => void;
			if (random() < 0.1 && movable.length > 1) {
				const before = order;
				const from = movable[Math.floor(random() * movable.length)]!;
				const to = movable[Math.floor(random() * movable.length)]!;
				if (from == to) continue;
				const rest = order.filter(i => i != from);
				rest.splice(rest.indexOf(to) + (random() < 0.5 ? 1 : 0), 0, from);
				order = rest;
				undo = () => (order = before);
			} else {
				const n = names[Math.floor(random() * names.length)]!;
				const letter = LETTERS[Math.floor(random() * LETTERS.length)]!;
				const old = n.letter;
				if (letter == old || n.taboo.has(letter)) continue;
				const clash = [...n.conflicts].filter(c => c.letter == letter);
				if (clash.length > 1) continue;
				const other = clash[0];
				if (other && (other.taboo.has(old) || [...other.conflicts].some(c => c != n && c.letter == old))) continue;
				n.letter = letter;
				if (other) other.letter = old;
				refresh(n);
				if (other) refresh(other);
				undo = () => {
					n.letter = old;
					if (other) (other.letter = letter, refresh(other));
					refresh(n);
				};
			}
			const next = deflated(render());
			if (next <= current || random() < Math.exp((current - next) / temperature)) {
				current = next;
				if (next < best) (best = next), (bestState = { letters: names.map(n => n.letter), order });
			} else undo();
		}
		names.forEach((n, i) => (n.letter = bestState.letters[i]!));
		order = bestState.order;
		assertRenamed(parts, parts.map((_, i) => text(i)));
	}
	return order.map(text).join('');
}

/** Replaces whole-word constant names with their numeric value, as an abstract literal. */
export const substituteConstants = (s: string, consts: Record<string, number>) =>
	s.replace(new RegExp(`\\b(?:${Object.keys(consts).sort((a, b) => b.length - a.length).join('|')})\\b`, 'g'), name => String(consts[name]));
