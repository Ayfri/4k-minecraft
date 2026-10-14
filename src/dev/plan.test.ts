import { describe, expect, test } from 'bun:test';
import { AIR, BRICKS, BYTES, DIRT, FLOWER, GLASS, GRASS, idx, LOG, PLANKS, SIZE, STONE, target, type Vec3, WATER } from '../world.ts';
import { ANY, BLUEPRINTS, type Blueprint } from './blueprints.ts';
import { aim, explore, jobs, route, site, stands, supported } from './plan.ts';

const house = BLUEPRINTS.house!;

/** A full-size world with grass on top of dirt: the top cell is `floor - 1`, the feet stand at `floor`. */
const flat = (floor: number) => {
	const V = new Uint8Array(BYTES).fill(DIRT, 0, idx(0, floor - 1, 0));
	return V.fill(GRASS, idx(0, floor - 1, 0), idx(0, floor, 0));
};
const eye: Vec3 = [100.5, 11.62, 100.5];
const cells = (bp: Blueprint) => {
	const out: [number, number, number, number][] = [];
	for (let y = 0; y < 9; y++) for (let z = 0; z < 9; z++) for (let x = 0; x < 9; x++) out.push([x, y, z, bp.cell(x, y, z)!]);
	return out;
};
const dirOf = ([yaw, pitch]: [number, number]): Vec3 => [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];

describe('house blueprint', () => {
	test('296 blocks of the placeable palette in a 9x9x9 box', () => {
		const blocks = cells(house).filter(([, , , b]) => b > AIR);
		expect(blocks).toHaveLength(296);
		expect(blocks.every(([, , , b]) => b >= GRASS && b <= GLASS)).toBe(true);
		expect(house.size).toEqual([9, 9, 9]);
		expect(house.cell(9, 0, 0)).toBeUndefined();
		expect(house.cell(0, -1, 0)).toBeUndefined();
	});

	test('the door is open, the five windows are glass, the lintel is planks', () => {
		for (const [x, y, z] of [[4, 1, 1], [4, 2, 1]] as const) expect(house.cell(x, y, z)).toBe(AIR);
		for (const [x, y, z] of [[2, 2, 1], [6, 2, 1], [1, 2, 4], [7, 2, 4], [4, 2, 7]] as const) expect(house.cell(x, y, z)).toBe(GLASS);
		expect(house.cell(4, 3, 1)).toBe(PLANKS);
		expect(house.cell(1, 4, 1)).toBe(LOG);
		expect(house.cell(4, 8, 4)).toBe(BRICKS);
		expect(house.cell(0, 0, 0)).toBe(ANY);
	});

	test('mirror symmetric in x', () => {
		for (const [x, y, z, b] of cells(house)) expect(house.cell(8 - x, y, z)).toBe(b);
	});

	test('every block of an empty flat world gets placed, lowest supported cell first, nothing floats', () => {
		const V = flat(20);
		const origin: Vec3 = [100, 20, 100];
		for (let pending = jobs(V, house, origin); pending.length; pending = jobs(V, house, origin)) {
			expect(pending.every(j => j.want != AIR)).toBe(true);
			const open = pending.filter(j => supported(V, j.cell));
			expect(open.length).toBeGreaterThan(0);
			const { cell, want } = open.reduce((a, b) => (b.cell[1] < a.cell[1] ? b : a));
			V[idx(...cell)] = want;
		}
		expect(cells(house).every(([x, y, z, b]) => (b == ANY ? V[idx(100 + x, 20 + y, 100 + z)]! > WATER : V[idx(100 + x, 20 + y, 100 + z)] == b))).toBe(true);
	});

	test('a cell with no solid neighbour is not supported', () => {
		expect(supported(flat(20), [100, 25, 100])).toBe(false);
		expect(supported(flat(20), [100, 20, 100])).toBe(true);
	});
});

describe('aim', () => {
	test('its angles reproduce the planned hit through the game target', () => {
		const V = flat(10);
		const a = aim(V, eye, [100, 10, 103], 'place')!;
		expect(a).toBeDefined();
		expect(target(V, eye, dirOf(a.A))).toEqual(a.hit);
		expect(a.hit[1]).toBe(idx(100, 10, 103));
	});

	test('nothing past reach', () => {
		expect(aim(flat(10), eye, [100, 10, 106], 'place')).toBeUndefined();
	});

	test('a cell above the eye with only a block below it is out of sight', () => {
		const V = flat(10);
		V[idx(100, 10, 103)] = V[idx(100, 11, 103)] = STONE;
		expect(aim(V, eye, [100, 12, 103], 'place')).toBeUndefined();
	});

	test('a row neighbour gives a sideways face', () => {
		const V = flat(10);
		for (let y = 10; y < 13; y++) V[idx(99, y, 103)] = STONE;
		expect(aim(V, eye, [100, 12, 103], 'place')?.hit[0]).toBe(idx(99, 12, 103));
	});

	test('a plant in the cell is targeted itself and replaced', () => {
		const V = flat(10);
		V[idx(100, 10, 103)] = FLOWER;
		expect(aim(V, eye, [100, 10, 103], 'place')?.hit[0]).toBe(idx(100, 10, 103));
	});

	test('a plant in front of the support makes the aim fail', () => {
		const V = flat(10);
		for (let x = 98; x < 103; x++) for (let y = 10; y < 13; y++) V[idx(x, y, 102)] = FLOWER;
		expect(aim(V, eye, [100, 10, 104], 'place')).toBeUndefined();
	});

	test('looking straight down clamps the pitch and still hits the block under the feet', () => {
		const a = aim(flat(10), eye, [100, 9, 100], 'break')!;
		expect(a.A[1]).toBe(-1.55);
		expect(a.hit[0]).toBe(idx(100, 9, 100));
	});
});

describe('stands', () => {
	test('never overlap the cell, rest on it or rest on a pending break', () => {
		const V = flat(10);
		const map = explore(V, [100.5, 10, 100.5], 6);
		const at = (list: Vec3[], x: number, y: number, z: number) => list.some(s => s[0] == x && s[1] == y && s[2] == z);
		const plain = stands(V, map, [102, 10, 100], new Set());
		expect(plain.length).toBeGreaterThan(10);
		expect(at(plain, 102, 10, 100)).toBe(false);
		expect(at(plain, 101, 10, 100)).toBe(true);
		expect(at(stands(V, map, [102, 9, 100], new Set()), 102, 10, 100)).toBe(false);
		expect(at(stands(V, map, [102, 10, 100], new Set([idx(103, 9, 100)])), 103, 10, 100)).toBe(false);
	});
});

describe('explore and route', () => {
	const reach = (V: Uint8Array, from: Vec3, goal: Vec3, radius = 8) => route(explore(V, from, radius), idx(...goal));

	test('a one block step goes up, two do not', () => {
		const V = flat(10);
		V[idx(103, 10, 100)] = STONE;
		expect(reach(V, [100.5, 10, 100.5], [103, 11, 100])).toBeDefined();
		V[idx(103, 11, 100)] = STONE;
		expect(reach(V, [100.5, 10, 100.5], [103, 12, 100])).toBeUndefined();
	});

	test('a drop of 3 is walked, 4 is not', () => {
		const V = flat(10);
		for (let y = 10; y < 13; y++) V[idx(100, y, 100)] = STONE;
		expect(reach(V, [100.5, 13, 100.5], [101, 10, 100])).toBeDefined();
		V[idx(100, 13, 100)] = STONE;
		expect(reach(V, [100.5, 14, 100.5], [101, 10, 100])).toBeUndefined();
	});

	test('a 2 high gap passes, a 1 high gap does not', () => {
		const V = flat(10);
		for (let z = 95; z <= 105; z++) for (let y = 10; y < 14; y++) V[idx(103, y, z)] = STONE;
		V[idx(103, 10, 100)] = V[idx(103, 11, 100)] = AIR;
		expect(reach(V, [100.5, 10, 100.5], [105, 10, 100], 5)).toBeDefined();
		V[idx(103, 11, 100)] = STONE;
		expect(reach(V, [100.5, 10, 100.5], [105, 10, 100], 5)).toBeUndefined();
	});

	test('the path wraps across the x seam', () => {
		const path = reach(flat(10), [SIZE - 1.5, 10, 100.5], [2, 10, 100])!;
		expect(path).toHaveLength(4);
		expect(path.at(-1)).toEqual([2.5, 10, 100.5]);
	});

	test('a water channel is crossed by swimming', () => {
		const V = flat(10);
		for (let z = 90; z < 110; z++) for (let x = 103; x < 105; x++) V[idx(x, 8, z)] = V[idx(x, 9, z)] = WATER;
		const path = reach(V, [100.5, 10, 100.5], [106, 10, 100])!;
		expect(path.some(([x, y]) => x == 103.5 && y == 9)).toBe(true);
	});
});

describe('site', () => {
	test('a flat patch beats bumpy ground, and the origin takes the patch height', () => {
		const V = new Uint8Array(BYTES);
		for (let x = 60; x < 200; x++) {
			for (let z = 60; z < 200; z++) {
				const h = x >= 130 && x < 150 && z >= 130 && z < 150 ? 22 : 20 + ((x * 7 + z * 13) % 5);
				for (let y = 0; y < h; y++) V[idx(x, y, z)] = STONE;
			}
		}
		const [ox, oy, oz] = site(V, [100, 100], house)!;
		expect(oy).toBe(21);
		expect(ox).toBeGreaterThanOrEqual(132);
		expect(ox).toBeLessThanOrEqual(140);
		expect(oz).toBeGreaterThanOrEqual(132);
		expect(oz).toBeLessThanOrEqual(140);
	});

	test('the first flat spot is centered on the start point', () => {
		expect(site(flat(20), [100, 100], house)).toEqual([96, 19, 96]);
	});

	test('water in the volume and trees move the site', () => {
		const inside = ([ox, , oz]: Vec3) => ox - 2 <= 100 && ox + 10 >= 100 && oz - 2 <= 100 && oz + 10 >= 100;
		const pond = flat(20);
		pond[idx(100, 19, 100)] = WATER;
		expect(inside(site(pond, [100, 100], house)!)).toBe(false);
		const tree = flat(20);
		for (let y = 20; y < 23; y++) tree[idx(100, y, 100)] = LOG;
		expect(inside(site(tree, [100, 100], house)!)).toBe(false);
	});
});

describe('jobs', () => {
	test('a pit is filled with DIRT, then GRASS on top', () => {
		const V = flat(20);
		for (let y = 17; y < 20; y++) V[idx(95, y, 95)] = AIR;
		const list = jobs(V, house, [96, 19, 96]);
		const want = (y: number) => list.find(j => j.cell[0] == 95 && j.cell[1] == y && j.cell[2] == 95)?.want;
		expect([want(17), want(18), want(19)]).toEqual([DIRT, DIRT, GRASS]);
	});

	test('a wrong solid is broken first, then the block is placed', () => {
		const V = flat(20);
		const origin: Vec3 = [96, 19, 96];
		const floor = (list: ReturnType<typeof jobs>) => list.find(j => j.cell[0] == 100 && j.cell[1] == 19 && j.cell[2] == 100)?.want;
		expect(floor(jobs(V, house, origin))).toBe(AIR);
		V[idx(100, 19, 100)] = AIR;
		expect(floor(jobs(V, house, origin))).toBe(PLANKS);
	});
});
