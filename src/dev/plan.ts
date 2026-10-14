import { AIR, DIRT, GRASS, HEIGHT, idx, LAYER, LEAVES, LOG, MASK, SIZE, solid, target, TOP, WATER, type Vec3 } from '../world.ts';
import { ANY, type Blueprint } from './blueprints.ts';

/** Eye height above the feet, as in the frame loop of `main.ts`. */
export const EYE = 1.62;
/** Under the 6 blocks of `target`, which marches in 0.02 steps. */
export const REACH = 5.8;
/** Cells around the blueprint box that are levelled with it (ground at y 0, air up to y 3). */
export const MARGIN = 2;

/** Stand cells reachable from the start: route cost and the previous cell (-1 for the start), keyed by `idx`. */
export type Explored = Map<number, [cost: number, prev: number]>;
export interface Job {
	cell: Vec3;
	want: number;
}
export interface Aim {
	A: [number, number];
	hit: [number, number];
}

/** Shortest signed delta on the wrapping x and z axes. */
export const wrap = (d: number) => ((d % SIZE) + SIZE * 1.5) % SIZE - SIZE / 2;

export const cellOf = (i: number): Vec3 => [i & MASK, i >> 20, (i >> 10) & MASK];

/** Whether the feet fit in cell (x, y, z): two free cells, on a solid cell or swimming. */
export const standable = (V: Uint8Array, x: number, y: number, z: number) =>
	!solid(V, x, y, z) && !solid(V, x, y + 1, z) && (solid(V, x, y - 1, z) || V[idx(x, y, z)] == WATER);

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** The stand cell reached by walking from (x, y, z) into column (nx, nz): same level, a fall of up to 3, or a one block jump. */
const step = (V: Uint8Array, x: number, y: number, z: number, nx: number, nz: number) => {
	for (let ny = y; ny >= y - 3 && !solid(V, nx, ny, nz) && !solid(V, nx, ny + 1, nz); ny--) {
		if (standable(V, nx, ny, nz)) return ny;
	}
	return !solid(V, x, y + 2, z) && standable(V, nx, y + 1, nz) ? y + 1 : undefined;
};

/** Breadth first search over stand cells within `radius` columns of `from`. */
export const explore = (V: Uint8Array, from: Vec3, radius = 24): Explored => {
	const [sx, sy, sz] = [Math.floor(from[0]) & MASK, Math.floor(from[1] + .01), Math.floor(from[2]) & MASK];
	const start = idx(sx, sy, sz);
	const map: Explored = new Map([[start, [0, -1]]]);
	const queue = [start];
	for (const k of queue) {
		const [x, y, z] = cellOf(k);
		for (const [dx, dz] of DIRS) {
			const [nx, nz] = [(x + dx) & MASK, (z + dz) & MASK];
			if (Math.abs(wrap(nx - sx)) > radius || Math.abs(wrap(nz - sz)) > radius) continue;
			const ny = step(V, x, y, z, nx, nz);
			if (ny === undefined) continue;
			const n = idx(nx, ny, nz);
			if (map.has(n)) continue;
			map.set(n, [map.get(k)![0] + 1, k]);
			queue.push(n);
		}
	}
	return map;
};

/** Cell centers from the start (excluded) to `goal`, `undefined` when the goal was not explored. */
export const route = (map: Explored, goal: number): Vec3[] | undefined => {
	if (!map.has(goal)) return;
	const path: Vec3[] = [];
	for (let k = goal; map.get(k)![1] >= 0; k = map.get(k)![1]) {
		const [x, y, z] = cellOf(k);
		path.push([x + .5, y, z + .5]);
	}
	return path.reverse();
};

const POINTS = [.5, .2, .8];

/** Yaw and pitch that make the game's own `target` hit `cell` (break) or place into it (place) from `eye`, tried on the faces of its neighbours. */
export const aim = (V: Uint8Array, eye: Vec3, cell: Vec3, kind: 'break' | 'place'): Aim | undefined => {
	const place = kind == 'place';
	const ci = idx(...cell);
	const here = V[ci]!;
	if (place ? here > WATER : !here || here == WATER) return;
	const rel = (a: number, p: number) => (a == 1 ? p - eye[1] : wrap(p - eye[a]!));
	const faces: { a: 0 | 1 | 2; d: number; s: number }[] = [];
	for (const a of [0, 1, 2] as const) {
		for (const s of [-1, 1]) {
			const n: Vec3 = [...cell];
			n[a] += s;
			if (solid(V, ...n) != place) continue;
			faces.push({ a, d: Math.hypot(...([0, 1, 2].map(k => rel(k, cell[k]! + (k == a ? +(s > 0) : .5))) as Vec3)), s });
		}
	}
	for (const { a, s } of faces.sort((p, q) => p.d - q.d)) {
		const [b, c] = [(a + 1) % 3, (a + 2) % 3] as const;
		for (const u of POINTS) {
			for (const w of POINTS) {
				const p: Vec3 = [0, 0, 0];
				p[a] = rel(a, cell[a] + +(s > 0) + (place ? s : -s) * .01);
				p[b] = rel(b, cell[b]! + u);
				p[c] = rel(c, cell[c]! + w);
				if ((place ? s : -s) * p[a] <= 0 || Math.hypot(...p) > REACH) continue;
				const A: [number, number] = [Math.atan2(p[0], p[2]), Math.max(-1.55, Math.min(1.55, Math.atan2(p[1], Math.hypot(p[0], p[2]))))];
				const [sy, sp] = A.map(Math.sin) as typeof A;
				const [cy, cp] = A.map(Math.cos) as typeof A;
				const hit = target(V, eye, [sy * cp, sp, cy * cp]);
				if (hit && (place ? (hit[1] == ci && V[hit[0]]! > WATER) || hit[0] == ci : hit[0] == ci)) return { A, hit };
			}
		}
	}
};

/** Whether standing on `at` would overlap `cell`, rest on it, or rest on a block that is about to be broken. */
export const unsafe = (at: Vec3, cell: Vec3, breaking: ReadonlySet<number>) => {
	const [c, body, under] = [idx(...cell), idx(at[0], at[1], at[2]), idx(at[0], at[1] - 1, at[2])];
	return c == body || c == idx(at[0], at[1] + 1, at[2]) || c == under || breaking.has(under);
};

/** Explored stand cells within 6 columns of `cell` that are safe to stand on, cheapest route first. */
export const stands = (V: Uint8Array, explored: Explored, cell: Vec3, breaking: ReadonlySet<number>) => {
	const found: [cost: number, at: Vec3][] = [];
	for (const [k, [cost]] of explored) {
		const at = cellOf(k);
		if (Math.hypot(wrap(at[0] - cell[0]), wrap(at[2] - cell[2])) <= 6 && Math.abs(at[1] - cell[1]) <= 7 && V[k] != WATER && !unsafe(at, cell, breaking)) found.push([cost, at]);
	}
	return found.sort((p, q) => p[0] - q[0]).map(([, at]) => at);
};

const NEIGHBOURS: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/** Whether a block placed in `cell` would touch a solid one. */
export const supported = (V: Uint8Array, cell: Vec3) => NEIGHBOURS.some(([dx, dy, dz]) => solid(V, cell[0] + dx, cell[1] + dy, cell[2] + dz));

/** What still differs from the blueprint at `origin`: its box, the margin ring (ground, then air up to y 3) and the holes below y 0 (DIRT). A wrong solid yields a break (AIR) first. */
export const jobs = (V: Uint8Array, bp: Blueprint, origin: Vec3, margin = MARGIN): Job[] => {
	const [w, h, d] = bp.size;
	const out: Job[] = [];
	const need = (cell: Vec3, want: number) => {
		const v = V[idx(...cell)]!;
		if (want == ANY) return v > WATER ? undefined : GRASS;
		if (want == AIR) return v == AIR || v == WATER ? undefined : AIR;
		return v == want ? undefined : v > WATER ? AIR : want;
	};
	for (let x = -margin; x < w + margin; x++) {
		for (let z = -margin; z < d + margin; z++) {
			const inside = x >= 0 && x < w && z >= 0 && z < d;
			for (let y = 0; y < (inside ? h : 4); y++) {
				const cell: Vec3 = [(origin[0] + x) & MASK, origin[1] + y, (origin[2] + z) & MASK];
				const want = need(cell, inside ? bp.cell(x, y, z)! : y ? AIR : ANY);
				if (want !== undefined) out.push({ cell, want });
			}
			for (let y = origin[1] - 1; y >= 0 && !solid(V, origin[0] + x, y, origin[2] + z); y--) out.push({ cell: [(origin[0] + x) & MASK, y, (origin[2] + z) & MASK], want: DIRT });
		}
	}
	return out;
};

const ground = (b: number) => b > WATER && b != LOG && b != LEAVES;

/** Origin of the flattest, tree-free spot around `near` (the house center): the median ground height of the footprint, the cheapest levelling wins, nearest first. */
export const site = (V: Uint8Array, near: [number, number], bp: Blueprint, radius = 48): Vec3 | undefined => {
	const [w, h, d] = bp.size;
	const tops = new Int8Array(LAYER).fill(-2);
	const top = (x: number, z: number) => {
		const k = idx(x, 0, z);
		if (tops[k] == -2) {
			let y = TOP;
			while (y >= 0 && !ground(V[idx(x, y, z)]!)) y--;
			tops[k] = y;
		}
		return tops[k]!;
	};
	let best: Vec3 | undefined;
	let low = Infinity;
	for (let r = 0; r <= radius; r++) {
		for (let dx = -r; dx <= r; dx++) {
			for (let dz = -r; dz <= r; dz += Math.abs(dx) == r ? 1 : 2 * r) {
				const [ox, oz] = [Math.floor(near[0]) + dx - (w >> 1), Math.floor(near[1]) + dz - (d >> 1)];
				const heights: number[] = [];
				for (let x = -MARGIN; x < w + MARGIN; x++) for (let z = -MARGIN; z < d + MARGIN; z++) heights.push(top(ox + x, oz + z));
				const base = [...heights].sort((p, q) => p - q)[heights.length >> 1]!;
				if (base < 4 || base + h > HEIGHT || heights.some(y => Math.abs(y - base) > 4)) continue;
				let cost = heights.reduce((sum, y) => sum + Math.abs(y - base), 0);
				for (let x = -MARGIN; x < w + MARGIN && cost < low; x++) {
					for (let z = -MARGIN; z < d + MARGIN; z++) {
						for (let y = base - 4; y < base + h; y++) {
							const b = V[idx(ox + x, y, oz + z)];
							cost += b == WATER ? Infinity : b == LOG || b == LEAVES ? 4 : 0;
						}
					}
				}
				if (cost >= low) continue;
				low = cost;
				best = [ox & MASK, base, oz & MASK];
				if (!low) return best;
			}
		}
	}
	return best;
};

/** Cheapest column of DIRT (1 to 7 blocks) on a stand cell within 5 columns of `cell` that brings it in aim. `spare` tells which cells may hold scaffold. */
export const pillar = (V: Uint8Array, cell: Vec3, kind: 'break' | 'place', explored: Explored, spare: (cell: Vec3) => boolean, skip: ReadonlySet<number> = new Set()) => {
	const found: { at: Vec3; height: number; score: number }[] = [];
	for (const [k, [cost]] of explored) {
		const at = cellOf(k);
		if (Math.hypot(wrap(at[0] - cell[0]), wrap(at[2] - cell[2])) > 5 || V[k] == WATER) continue;
		for (let height = 1; height <= 7 && at[1] + height + 1 < HEIGHT; height++) {
			const inColumn = (cell[0] & MASK) == at[0] && (cell[2] & MASK) == at[2] && cell[1] >= at[1] && cell[1] <= at[1] + height + 1;
			if (inColumn || solid(V, at[0], at[1] + height + 1, at[2]) || !spare([at[0], at[1] + height - 1, at[2]])) break;
			found.push({ at, height, score: cost + 3 * height });
		}
	}
	found.sort((p, q) => p.score - q.score);
	/** The player stops within 0.07 of the cell center along its walking axis: columns whose aim holds there too go first, a column that only works dead center is the fallback. */
	for (const offsets of [[[0, 0], [-.07, 0], [.07, 0], [0, -.07], [0, .07]], [[0, 0]]]) {
		for (const { at, height } of found) {
			const key = idx(...at) * 8 + height;
			if (skip.has(key)) continue;
			const column = Array.from({ length: height }, (_, i) => idx(at[0], at[1] + i, at[2]));
			const old = column.map(i => V[i]!);
			/** Synchronous, so no frame sees the scaffold: the GPU copy of the world only changes through `put`. */
			try {
				for (const i of column) V[i] = DIRT;
				if (offsets.every(([dx, dz]) => aim(V, [at[0] + .5 + dx!, at[1] + height + EYE, at[2] + .5 + dz!], cell, kind))) return { at, height, key };
			} finally {
				column.forEach((i, n) => (V[i] = old[n]!));
			}
		}
	}
};
