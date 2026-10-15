/** A raw deflate encoder that searches the exact bit stream (parse, Huffman header and bit phase) for the smallest stream without forbidden bytes. */
const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_BITS = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_BITS = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
const EOB = 256;
const INF = 1 << 30;

const LEN_CODE = Uint8Array.from({ length: 259 }, (_, l) => LEN_BASE.findLastIndex(b => b <= l));
const DIST_CODE = Uint8Array.from({ length: 32769 }, (_, d) => DIST_BASE.findLastIndex(b => b <= d));

/** Code lengths of at most `limit` bits for `freq`: Huffman merges, counts halved until the limit holds. */
export function huffman(freq: ArrayLike<number>, limit: number): Uint8Array {
	const lengths = new Uint8Array(freq.length);
	const used = Array.from({ length: freq.length }, (_, i) => i)
		.filter(i => freq[i])
		.sort((a, b) => freq[a]! - freq[b]!);
	const k = used.length;
	if (k < 2) return k ? lengths.fill(1, used[0], used[0]! + 1) : lengths;
	const weight = new Float64Array(2 * k - 1);
	const parent = new Int32Array(2 * k - 1);
	const depth = new Uint8Array(2 * k - 1);
	used.forEach((s, i) => (weight[i] = freq[s]!));
	for (;;) {
		let leaf = 0;
		let node = k;
		let next = k;
		const take = () => (leaf < k && (node >= next || weight[leaf]! <= weight[node]!) ? leaf++ : node++);
		for (; next < 2 * k - 1; next++) {
			const [x, y] = [take(), take()];
			weight[next] = weight[x]! + weight[y]!;
			parent[x] = parent[y] = next;
		}
		for (let i = 2 * k - 3; i >= 0; i--) depth[i] = depth[parent[i]!]! + 1;
		if (Math.max(...depth.subarray(0, k)) <= limit) {
			used.forEach((s, i) => (lengths[s] = depth[i]!));
			return lengths;
		}
		for (let i = 0; i < k; i++) weight[i] = (weight[i]! + 1) >> 1;
	}
}

/** Canonical codes of `lengths`, bit-reversed so they append LSB first. */
function codes(lengths: Uint8Array) {
	const count = new Uint16Array(16);
	for (const l of lengths) if (l) count[l]!++;
	const next = new Uint16Array(16);
	for (let l = 1, code = 0; l < 16; l++) next[l] = code = (code + count[l - 1]!) << 1;
	return Uint16Array.from(lengths, l => {
		if (!l) return 0;
		let c = next[l]!++;
		let r = 0;
		for (let i = 0; i < l; i++, c >>= 1) r = (r << 1) | (c & 1);
		return r;
	});
}

/** Transitions of the search graph, grouped by source node: two bit pieces (value, count) appended in turn, and the symbols they stand for. */
class Edges {
	a: number[] = [];
	b: number[] = [];
	/** The Huffman code-length symbol, or -1. */
	cl: number[] = [];
	/** The distance symbol, or -1. */
	dist: number[] = [];
	from: number[] = [];
	/** The literal/length symbol, or -1. */
	lit: number[] = [];
	na: number[] = [];
	nb: number[] = [];
	to: number[] = [];

	/** These edges followed by `other`'s, which must start at a later node. */
	concat(other: Edges) {
		const out = new Edges();
		for (const key of ['a', 'b', 'cl', 'dist', 'from', 'lit', 'na', 'nb', 'to'] as const) out[key] = this[key].concat(other[key]);
		return out;
	}

	push(from: number, to: number, a: number, na: number, sym: { cl?: number; dist?: number; lit?: number }, b = 0, nb = 0) {
		this.from.push(from);
		this.to.push(to);
		this.a.push(a);
		this.na.push(na);
		this.b.push(b);
		this.nb.push(nb);
		this.cl.push(sym.cl ?? -1);
		this.dist.push(sym.dist ?? -1);
		this.lit.push(sym.lit ?? -1);
	}
}

export interface Model {
	/** Code length of every distance symbol (0..29), 0 makes a symbol unavailable. */
	dist: Uint8Array;
	/** Code length of every literal/length symbol (0..285), 0 makes a symbol unavailable. */
	lit: Uint8Array;
}

export interface Result {
	/** Stream length in bits before the zero padding of the last byte. */
	bits: number;
	bytes: Uint8Array;
	cl: number[];
	dist: number[];
	lit: number[];
}

interface Token {
	bits: number;
	count: number;
	sym: number;
	/** How many entries of the length list the token covers. */
	span: number;
}

interface Head {
	edges: Edges;
	/** Length of the code-length list, the data nodes start there. */
	m: number;
	prefix: [number, number][];
	/** Bit phase after the prefix. */
	start: number;
}

/** The code lengths a dynamic block transmits: literal/length then distance, trailing zeros trimmed. */
function lengthList({ dist, lit }: Model) {
	const hlit = Math.max(257, lit.findLastIndex(Boolean) + 1);
	const hdist = Math.max(1, dist.findLastIndex(Boolean) + 1);
	return { hdist, hlit, list: [...lit.subarray(0, hlit), ...dist.subarray(0, hdist)] };
}

/** Per position of a code-length list, every way to start coding it: the length itself, or a repeat (16) or zero run (17, 18). */
function tokensOf(list: number[]) {
	const m = list.length;
	const same = Array.from({ length: m + 1 }, () => 0);
	const zeros = same.slice();
	for (let p = m - 1; p >= 0; p--) {
		zeros[p] = list[p] ? 0 : zeros[p + 1]! + 1;
		same[p] = p && list[p] === list[p - 1] ? same[p + 1]! + 1 : 0;
	}
	return list.map((v, p): Token[] => {
		const out: Token[] = [{ bits: 0, count: 0, span: 1, sym: v }];
		for (let r = 3; r <= 6 && p && r <= same[p]!; r++) out.push({ bits: r - 3, count: 2, span: r, sym: 16 });
		for (let r = 3; r <= 138 && r <= zeros[p]!; r++) out.push(r <= 10 ? { bits: r - 3, count: 3, span: r, sym: 17 } : { bits: r - 11, count: 7, span: r, sym: 18 });
		return out;
	});
}

/** The cheapest code for the tokens: cheapest tokenization under a code and the Huffman code of that tokenization, alternated. Bits count the tokens and the 3 bits per sent code length. */
function lengthCode(tokens: Token[][], rounds = 12) {
	const m = tokens.length;
	let best: { bits: number; cl: Uint8Array } = { bits: INF, cl: new Uint8Array(19) };
	for (let round = 0, len: Uint8Array = new Uint8Array(19).fill(4); round < rounds; round++) {
		const cost = new Float64Array(m + 1);
		const pick = new Array<Token>(m);
		const spare = Math.max(...len) + 1;
		for (let p = m - 1; p >= 0; p--) {
			cost[p] = INF;
			for (const t of tokens[p]!) {
				const c = (len[t.sym] || spare) + t.count + cost[p + t.span]!;
				if (c < cost[p]!) ((cost[p] = c), (pick[p] = t));
			}
		}
		const freq = new Array<number>(19).fill(0);
		let extra = 0;
		for (let p = 0; p < m; p += pick[p]!.span) (freq[pick[p]!.sym]!++, (extra += pick[p]!.count));
		len = huffman(freq, 7);
		const bits = freq.reduce((s, f, sym) => s + f * len[sym]!, 0) + 3 * Math.max(4, CL_ORDER.findLastIndex(s => len[s]) + 1) + extra;
		if (bits < best.bits) best = { bits, cl: len };
	}
	return best;
}

/** Bits of the cheapest tokenization under the fixed code lengths `cl`, header fields included. */
function codedBits(tokens: Token[][], cl: Uint8Array) {
	const cost = new Float64Array(tokens.length + 1);
	for (let p = tokens.length - 1; p >= 0; p--) cost[p] = Math.min(INF, ...tokens[p]!.map(t => (cl[t.sym] ? cl[t.sym]! + t.count + cost[p + t.span]! : INF)));
	return 17 + 3 * Math.max(4, CL_ORDER.findLastIndex(s => cl[s]) + 1) + cost[0]!;
}

/** Bits of a dynamic block header for these code lengths. */
export const headerBits = (model: Model) => 17 + lengthCode(tokensOf(lengthList(model).list)).bits;

/** How many bytes come before the first one that a match (3 bytes seen at most 32768 back) can start at, the data length when none can. */
export function leadOf(data: Uint8Array) {
	const last = new Map<number, number>();
	for (let i = 0; i + 2 < data.length; i++) {
		const key = data[i]! | (data[i + 1]! << 8) | (data[i + 2]! << 16);
		if (i - (last.get(key) ?? -Infinity) <= 32768) return i;
		last.set(key, i);
	}
	return data.length;
}

export class Deflater {
	/** Per position, the earlier distances that match at least 3 bytes and how long. */
	private readonly matches: { d: number[]; l: number[] }[];
	private readonly bad = new Uint8Array(256);
	readonly lead: number;

	constructor(readonly data: Uint8Array) {
		const n = data.length;
		this.matches = Array.from({ length: n }, () => ({ d: [], l: [] }));
		let prev = new Uint16Array(n + 1);
		let cur = new Uint16Array(n + 1);
		for (let i = n - 1; i >= 0; i--) {
			for (let j = Math.max(0, i - 32768); j < i; j++) {
				const len = data[i] === data[j] ? Math.min(258, prev[j + 1]! + 1) : 0;
				cur[j] = len;
				if (len >= 3) (this.matches[i]!.d.push(i - j), this.matches[i]!.l.push(len));
			}
			[prev, cur] = [cur, prev];
		}
		this.lead = leadOf(data);
	}

	/** A model from the symbol counts of a result, symbols it never used get `spare` bits when set (exploring) and are unavailable otherwise. */
	static model({ dist, lit }: Pick<Result, 'dist' | 'lit'>, spare = 0): Model {
		const fill = (l: Uint8Array) => (spare ? l.map(x => x || spare) : l);
		return { dist: fill(huffman(dist, 15)), lit: fill(huffman(lit, 15)) };
	}

	/** Appends `count` bits to the bit phase `state` (`1 << k | partial byte`), -1 when a finished byte is forbidden. */
	private append(state: number, bits: number, count: number) {
		let k = 31 - Math.clz32(state);
		let p = state ^ (1 << k);
		while (count) {
			const take = Math.min(count, 8 - k);
			p |= (bits & ((1 << take) - 1)) << k;
			bits >>>= take;
			count -= take;
			k += take;
			if (k === 8) {
				if (this.bad[p]) return -1;
				p = k = 0;
			}
		}
		return (1 << k) | p;
	}

	/** The last byte of a stream ending in bit phase `state`: its free padding bits are set to the first value that is not forbidden, -1 when none is. */
	private pad(state: number) {
		const k = 31 - Math.clz32(state);
		const p = state ^ (1 << k);
		for (let hi = 0; hi < 1 << (8 - k); hi++) if (!this.bad[p | (hi << k)]) return p | (hi << k);
		return -1;
	}

	/** The header for the code lengths `cl` of the list `tokens`: its code-length edges as nodes 0..list length, the stream prefix before them and the bit phase it ends in, undefined when the prefix holds a forbidden byte. */
	private open(hlit: number, hdist: number, tokens: Token[][], cl: Uint8Array): Head | undefined {
		const hclen = Math.max(4, CL_ORDER.findLastIndex(s => cl[s]) + 1);
		const prefix: [number, number][] = [[1, 1], [2, 2], [hlit - 257, 5], [hdist - 1, 5], [hclen - 4, 4], ...CL_ORDER.slice(0, hclen).map((s): [number, number] => [cl[s]!, 3])];
		const start = prefix.reduce((state, [bits, count]) => (state < 0 ? state : this.append(state, bits, count)), 1);
		if (start < 0) return undefined;
		const edges = new Edges();
		const clCodes = codes(cl);
		tokens.forEach((options, p) => {
			for (const t of options) if (cl[t.sym]) edges.push(p, p + t.span, clCodes[t.sym]! | (t.bits << cl[t.sym]!), cl[t.sym]! + t.count, { cl: t.sym });
		});
		return { edges, m: tokens.length, prefix, start };
	}

	/** The headers to try for `model`: the cheapest code for the code lengths whose prefix holds no forbidden byte (swapping two of its lengths when the best does), then the next cheapest swaps. A header fixes the bit phase of what follows, and the literals before the first match have no other way around a forbidden byte. */
	private *headers(model: Model, limit = 8) {
		const { hdist, hlit, list } = lengthList(model);
		const tokens = tokensOf(list);
		const { cl: best } = lengthCode(tokens);
		const used = Array.from(best.keys()).filter(s => best[s]);
		const codings = [best, ...used.flatMap(a => used.filter(b => b > a && best[a] !== best[b]).map(b => best.slice().fill(best[a]!, b, b + 1).fill(best[b]!, a, a + 1)))];
		const first = codings.find(cl => this.open(hlit, hdist, tokens, cl));
		if (!first) return;
		yield this.open(hlit, hdist, tokens, first)!;
		const rest = codings.filter(cl => cl !== first).map(cl => ({ bits: codedBits(tokens, cl), cl }));
		let tried = 0;
		for (const { cl } of rest.sort((x, y) => x.bits - y.bits)) {
			const head = tried < limit && this.open(hlit, hdist, tokens, cl);
			if (head) (tried++, yield head);
		}
	}

	/** The cheapest stream under `model`: bit phases within `slack` bits of the best at each node are kept, `ways` distances per match length, `avoid` are byte values the stream must not contain. The first header that leads to a valid stream wins. */
	run(model: Model, options = {} as { avoid?: number[]; slack?: number; ways?: number; until?: number }): Result | undefined {
		this.bad.fill(0);
		for (const b of options.avoid ?? []) this.bad[b] = 1;
		let body: Edges | undefined;
		for (const head of this.headers(model)) {
			body ??= this.body(model, head.m, options.ways ?? 4, options.until);
			const result = this.walk(head, body, options.slack ?? 12, options.until);
			if (result) return result;
		}
	}

	/** The edges of the data nodes `m..m + until` (all of them and the end node by default) under `model`: they do not depend on the header, only on where it ends. */
	private body(model: Model, m: number, ways: number, until = this.data.length + 1) {
		const { data } = this;
		const edges = new Edges();
		const n = Math.min(until, data.length);
		const { dist: dists, lit: lits } = model;
		const litCodes = codes(lits);
		const distCodes = codes(dists);
		const distCost = (d: number) => dists[DIST_CODE[d]!]! + DIST_BITS[DIST_CODE[d]!]!;

		for (let i = 0; i < n; i++) {
			const node = m + i;
			const byte = data[i]!;
			if (lits[byte]) edges.push(node, node + 1, litCodes[byte]!, lits[byte]!, { lit: byte });
			const { d, l } = this.matches[i]!;
			const order = d.flatMap((_, k) => (dists[DIST_CODE[d[k]!]!] ? [k] : [])).sort((x, y) => distCost(d[x]!) - distCost(d[y]!) || d[x]! - d[y]!);
			const top = order.reduce((max, k) => Math.max(max, l[k]!), 0);
			for (let len = 3; len <= top; len++) {
				const lc = LEN_CODE[len]!;
				const sym = 257 + lc;
				if (!lits[sym]) continue;
				const a = litCodes[sym]! | ((len - LEN_BASE[lc]!) << lits[sym]!);
				for (let k = 0, taken = 0; k < order.length && taken < ways; k++) {
					const o = order[k]!;
					if (l[o]! < len) continue;
					taken++;
					const dc = DIST_CODE[d[o]!]!;
					edges.push(node, node + len, a, lits[sym]! + LEN_BITS[lc]!, { dist: dc, lit: sym }, distCodes[dc]! | ((d[o]! - DIST_BASE[dc]!) << dists[dc]!), dists[dc]! + DIST_BITS[dc]!);
				}
			}
		}
		if (until > data.length) edges.push(m + n, m + n + 1, litCodes[EOB]!, lits[EOB]!, { lit: EOB });
		return edges;
	}

	/** The stream of the best path to the end node, or with `until` only a stub when some stream gets past the first `until` bytes of data. */
	private walk({ edges: header, m, prefix, start }: Head, body: Edges, slack: number, until = this.data.length + 1): Result | undefined {
		const edges = header.concat(body);
		const end = m + until;
		const total = end + 1;
		const first = new Int32Array(total + 1).fill(edges.from.length);
		for (let e = edges.from.length - 1; e >= 0; e--) first[edges.from[e]!] = e;
		for (let u = total - 1; u >= 0; u--) if (first[u]! > first[u + 1]!) first[u] = first[u + 1]!;
		const cost = new Int32Array(total * 256).fill(INF);
		const back = new Int32Array(total * 256);
		cost[start] = prefix.reduce((sum, [, count]) => sum + count, 0);
		const { a, b, na, nb, to } = edges;
		for (let u = 0; u < end; u++) {
			const row = u * 256;
			let min = INF;
			for (let s = 1; s < 256; s++) if (cost[row + s]! < min) min = cost[row + s]!;
			if (min === INF) continue;
			for (let s = 1; s < 256; s++) {
				const c = cost[row + s]!;
				if (c > min + slack) continue;
				for (let e = first[u]!; e < first[u + 1]!; e++) {
					let t = this.append(s, a[e]!, na[e]!);
					if (t >= 0 && nb[e]) t = this.append(t, b[e]!, nb[e]!);
					if (t < 0) continue;
					const at = to[e]! * 256 + t;
					const nc = c + na[e]! + nb[e]!;
					if (nc < cost[at]!) (cost[at] = nc), (back[at] = (e << 8) | s);
				}
			}
		}

		if (until <= this.data.length) return cost.subarray(end * 256, end * 256 + 256).some(c => c < INF) ? ALIVE : undefined;
		let best = -1;
		for (let s = 1; s < 256; s++) if (this.pad(s) >= 0 && cost[end * 256 + s]! < (best < 0 ? INF : cost[end * 256 + best]!)) best = s;
		if (best < 0) return undefined;

		const path: number[] = [];
		for (let u = end, s = best; u; ) {
			const e = back[u * 256 + s]! >> 8;
			path.push(e);
			s = back[u * 256 + s]! & 255;
			u = edges.from[e]!;
		}
		path.reverse();
		const result: Result = { bits: 0, bytes: new Uint8Array(), cl: new Array<number>(19).fill(0), dist: new Array<number>(30).fill(0), lit: new Array<number>(286).fill(0) };
		const out: number[] = [];
		let acc = 0;
		let k = 0;
		const put = (bits: number, count: number) => {
			for (let i = 0; i < count; i++) {
				acc |= ((bits >> i) & 1) << k;
				if (++k === 8) (out.push(acc), (acc = k = 0));
			}
		};
		for (const [bits, count] of prefix) put(bits, count);
		for (const e of path) {
			put(a[e]!, na[e]!);
			put(b[e]!, nb[e]!);
			for (const [list, sym] of [[result.cl, edges.cl[e]!], [result.dist, edges.dist[e]!], [result.lit, edges.lit[e]!]] as const) if (sym >= 0) list[sym]!++;
		}
		result.bits = out.length * 8 + k;
		if (k) out.push(this.pad((1 << k) | acc));
		result.bytes = Uint8Array.from(out);
		return result;
	}
}

/** How many literal code length swaps `search` probes when the optimal code has no valid stream, and how many of the probes that pass it then runs in full. */
const SWAPS = 300;
const FULL = 6;
/** What a probe returns when some stream gets through. */
const ALIVE: Result = { bits: 0, bytes: new Uint8Array(), cl: [], dist: [], lit: [] };

/** A code gets through the literals before the first match with chance `(1 - avoid / 256) ** lead` and `search` tries `SWAPS + 1` codes: below 0.1 expected streams it is hopeless (2 KB of printable noise), and no suffix changes that. */
export const hopeless = (data: Uint8Array, avoid: number[]) => (1 - avoid.length / 256) ** leadOf(data) * (SWAPS + 1) < 0.1;

interface Counts {
	dist: number[];
	lit: number[];
}

/** Deterministic search for the smallest stream without `avoid` bytes: optimal parses under integer code lengths, with the symbol counts smoothed until the exact header plus data cost stops falling. */
export function search(data: Uint8Array, avoid = [0, 13], rounds = 4, { slack = 12, ways = 4, seed: start = 777 } = {}) {
	if (hopeless(data, avoid)) return;
	const deflater = new Deflater(data);
	const opts = { avoid, slack, ways };
	const lit = Array.from({ length: 286 }, () => 1);
	for (const b of data) lit[b]! += 4;
	let model: Model = { dist: huffman(Array.from({ length: 30 }, () => 1), 15), lit: huffman(lit, 15) };
	for (let i = 0; i < 12; i++) model = Deflater.model(deflater.run(model, { slack: 0, ways: 1 })!, 12);
	const free = deflater.run(model, { slack: 0, ways: 1 })!;
	const optimal = Deflater.model(free);
	let cur = deflater.run(optimal, opts);
	/** The literals before the first match have one path, so a forbidden byte on it kills every stream under this code, about 1 code in 250 gets through 140 of them. Exchanging the lengths of two literals (the cheapest exchanges first) gives them other codes, and a probe of the first bytes tells cheaply which codes are worth a full run. */
	const used = Array.from(optimal.lit.keys()).filter(s => optimal.lit[s]);
	const exchanges = used.flatMap(x => used.filter(y => y > x && optimal.lit[x] !== optimal.lit[y]).map((y): [number, number] => [x, y]));
	const price = ([x, y]: [number, number]) => (free.lit[x]! - free.lit[y]!) * (optimal.lit[y]! - optimal.lit[x]!);
	const until = deflater.lead + 256;
	let full = 0;
	for (const [x, y] of cur ? [] : exchanges.sort((p, q) => price(p) - price(q)).slice(0, SWAPS)) {
		const lit = optimal.lit.slice();
		[lit[x], lit[y]] = [lit[y]!, lit[x]!];
		const swapped = { dist: optimal.dist, lit };
		if (until < data.length && !deflater.run(swapped, { ...opts, until })) continue;
		if ((cur = deflater.run(swapped, opts)) || ++full === FULL) break;
	}
	let best = cur;
	let seed = start;
	const rnd = () => {
		let t = (seed = (seed + 0x6d2b79f5) | 0);
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	const modelOf = (g: Counts): Model => ({ dist: huffman(g.dist, 15), lit: huffman(g.lit, 15) });
	/** Exact bits of the parse counted in `f` under the code built from the smoothed counts `g`. */
	const cost = (g: Counts, f: Counts) => {
		const m = modelOf(g);
		let bits = headerBits(m);
		for (const key of ['lit', 'dist'] as const)
			for (let i = 0; i < f[key].length; i++) {
				if (f[key][i]! && !m[key][i]) return Infinity;
				bits += f[key][i]! * m[key][i]!;
			}
		return bits;
	};
	/** Copies a neighbour's count, flattens a window to its mean or rescales one count: the runs of equal lengths the header codes cheaply. */
	const mutate = (g: Counts): Counts => {
		const out = { dist: g.dist.slice(), lit: g.lit.slice() };
		const x = rnd() < 0.85 ? out.lit : out.dist;
		const kind = Math.floor(rnd() * 3);
		const a = Math.floor(rnd() * x.length);
		const end = a + 1 + Math.floor(rnd() * 8);
		if (kind === 0) x[a] = x[Math.min(x.length - 1, Math.max(0, a + Math.floor(rnd() * 9) - 4))]!;
		else if (kind === 1) {
			const used = x.slice(a, end).filter(Boolean);
			if (used.length) x.fill(used.reduce((s, v) => s + v) / used.length, a, end);
		} else x[a] = x[a]! * Math.exp(rnd() * 2 - 1);
		return out;
	};
	const steps = Math.min(2000, data.length >> 2);
	for (let round = 0; best && round < rounds; round++) {
		const f: Counts = { dist: (cur ?? best).dist, lit: (cur ?? best).lit };
		let g: Counts = { dist: f.dist.slice(), lit: f.lit.slice() };
		let c = cost(g, f);
		for (let i = 0; i < steps; i++) {
			const next = mutate(g);
			const nc = cost(next, f);
			if (nc <= c) [c, g] = [nc, next];
		}
		cur = deflater.run(modelOf(g), opts);
		if (cur && cur.bits < (best?.bits ?? Infinity)) best = cur;
	}
	return best?.bytes;
}
