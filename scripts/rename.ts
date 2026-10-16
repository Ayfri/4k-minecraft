/** Picks the name of every local binding by the deflate size of the whole script instead of by length, scope analysis keeps the program equivalent. */
import { analyze, type Scope, type Variable } from 'eslint-scope';
import type { Program } from 'estree';
import { mulberry } from './lib/random.ts';
import type { Part } from './print.ts';
import { renameWgsl } from './wgsl.ts';

/** Mangled names are single letters, the search can pick any of them. */
const POOL = [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$'];

/** The local bindings of a script, which can share a name, and which names each can not take. */
export class Bindings {
	/** Each declaring or referencing Identifier node to its binding. */
	readonly byNode = new Map<object, number>();
	readonly conflicts: Set<number>[] = [];
	readonly forbidden: Set<string>[] = [];
	readonly names: string[] = [];
	/** The scope analysis of each binding: declarations and every read or write. */
	readonly variables: Variable[] = [];

	constructor(ast: Program) {
		const manager = analyze(ast, { ecmaVersion: 2025, sourceType: 'script' });
		const scopes = manager.scopes.filter(s => s.type !== 'global');
		const index = new Map<unknown, number>();
		for (const scope of scopes)
			for (const variable of scope.variables) {
				if (!variable.defs.length) continue;
				const binding = this.names.length;
				index.set(variable, binding);
				this.names.push(variable.name);
				this.variables.push(variable);
				this.conflicts.push(new Set());
				this.forbidden.push(new Set());
				for (const id of [...variable.identifiers, ...variable.references.map(r => r.identifier)]) this.byNode.set(id, binding);
			}
		/** Two bindings conflict when one is visible where the other is used. */
		for (const scope of scopes)
			for (const variable of scope.variables) {
				const i = index.get(variable);
				if (i === undefined) continue;
				for (const from of [scope, ...variable.references.map(r => r.from)]) {
					for (let s: Scope | null = from; s; s = s.upper) {
						for (const other of s.variables) {
							const j = index.get(other);
							if (j !== undefined && j !== i) this.conflicts[i]!.add(j), this.conflicts[j]!.add(i);
						}
						if (s === scope) break;
					}
				}
			}
		/** A global read or written inside a scope can not be shadowed by a binding of it. */
		for (const { from, identifier } of manager.globalScope!.through)
			for (let s: Scope | null = from; s && s.type !== 'global'; s = s.upper)
				for (const other of s.variables) if (index.has(other)) this.forbidden[index.get(other)!]!.add(identifier.name);
	}

	free(i: number, name: string, names: string[]) {
		if (this.forbidden[i]!.has(name)) return false;
		for (const j of this.conflicts[i]!) if (names[j] === name) return false;
		return true;
	}

	/** A valid naming to start from: the most used bindings take the first letters. */
	initial() {
		const uses = this.names.map(() => 0);
		for (const i of this.byNode.values()) uses[i]!++;
		const names: string[] = this.names.map(() => '');
		for (const i of this.names.keys().toArray().sort((a, b) => uses[b]! - uses[a]!)) names[i] = POOL.find(n => this.free(i, n, names))!;
		return names;
	}
}

/** Stands for the shader string in a render. */
const HOLE = '\u0001';

/** The script text for `names`, adjacent text pieces are merged once so a render is one join. The `hole` text, once in the parts, renders as `HOLE`. */
function renderer(parts: Part[], hole?: string) {
	const texts: string[] = [''];
	const slots: number[] = [];
	for (const p of parts)
		if (typeof p === 'number') (slots.push(p), texts.push(''));
		else texts[texts.length - 1] += p;
	if (hole) {
		const at = texts.findIndex(t => t.includes(hole));
		if (at < 0) throw new Error('the shader string is not in the script');
		texts[at] = texts[at]!.replace(hole, HOLE);
	}
	return (names: string[]) => texts.reduce((out, text, i) => out + (i ? names[slots[i - 1]!] : '') + text, '');
}

const deflated = (js: string) => Bun.deflateSync(new TextEncoder().encode(js), { level: 12, library: 'libdeflate' }).length;

/** Annealing steps of the script's own names once the shader is fixed (a few seconds, each step is a deflate of the script). */
const STEPS = 10000;

/** A WGSL shader (`src`) that is the string `JSON.stringify(src)` of the script: its names are annealed (`rounds` steps of one `seed`) against the size of the whole script. */
export interface Shader {
	rounds: number;
	seed?: number;
	src: string;
}

/** Coordinate descent over the names, then pairwise swaps, against the libdeflate size of the script, from the names the bindings already have, then with a `shader` the annealing of its names against the script around it and one more descent and an annealing of the script's names. */
export function chooseNames(parts: Part[], bindings: Bindings, rounds = 2, shader?: Shader) {
	const render = renderer(parts, shader && JSON.stringify(shader.src));
	const names = bindings.initial();
	let literal = shader ? JSON.stringify(renameWgsl(shader.src)) : '';
	const full = () => (shader ? render(names).replace(HOLE, () => literal) : render(names));
	let best = 0;
	/** Keeps `change` when it shrinks the stream, undoes it otherwise. */
	const attempt = (touched: number[], change: () => void, undo: () => void) => {
		change();
		const size = touched.every(i => bindings.free(i, names[i]!, names)) ? deflated(full()) : Infinity;
		if (size < best) return (best = size), true;
		return undo(), false;
	};
	const descend = () => {
		best = deflated(full());
		for (let round = 0, improved = true; improved && round < rounds; round++) {
			improved = false;
			for (let i = 0; i < names.length; i++)
				for (const name of POOL) {
					const old = names[i]!;
					if (name !== old && bindings.free(i, name, names)) improved = attempt([i], () => (names[i] = name), () => (names[i] = old)) || improved;
				}
			for (let i = 0; i < names.length; i++)
				for (let j = i + 1; j < names.length; j++) {
					const [a, b] = [names[i]!, names[j]!];
					if (a !== b) improved = attempt([i, j], () => ([names[i], names[j]] = [b, a]), () => ([names[i], names[j]] = [a, b])) || improved;
				}
		}
	};
	descend();
	if (shader?.rounds) {
		const js = render(names);
		const at = js.indexOf(HOLE);
		literal = JSON.stringify(renameWgsl(shader.src, shader.rounds, [`${js.slice(0, at)}"`, `"${js.slice(at + 1)}`], shader.seed));
		descend();
		/** Annealing steps of single names, the swap with the one binding of its conflicts that has the name when there is one. */
		const next = mulberry(shader.seed ?? 1);
		const random = () => next() / 2 ** 32;
		let current = best;
		let bestNames = [...names];
		for (let step = 0; names.length && step < STEPS; step++) {
			const i = Math.floor(random() * names.length);
			const name = POOL[Math.floor(random() * POOL.length)]!;
			const old = names[i]!;
			if (name === old) continue;
			const clash = [...bindings.conflicts[i]!].filter(j => names[j] === name);
			if (clash.length > 1) continue;
			const [j] = clash;
			names[i] = name;
			if (j !== undefined) names[j] = old;
			const size = bindings.free(i, name, names) && (j === undefined || bindings.free(j, old, names)) ? deflated(full()) : Infinity;
			if (size <= current || random() < Math.exp((current - size) / (0.5 * (0.05 / 0.5) ** (step / STEPS)))) {
				current = size;
				if (size < best) (best = size), (bestNames = [...names]);
			} else (names[i] = old), j !== undefined && (names[j] = name);
		}
		bestNames.forEach((n, i) => (names[i] = n));
	}
	return full();
}
