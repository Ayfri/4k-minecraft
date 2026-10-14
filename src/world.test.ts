import { describe, expect, test } from 'bun:test';
import { collides, HEIGHT, idx, move, SIZE, solid, STONE, target, type Vec3, WATER } from './world.ts';

/** A 16 MiB world with stone for every cell below `floor`. */
const flat = (floor: number) => new Uint8Array(1 << 24).fill(STONE, 0, idx(0, floor, 0));
const DT = .03;

/** Steps the physics like the frame loop (gravity capped at 30) until the feet land, returns the steps taken. */
const fall = (V: Uint8Array, p: Vec3, v: Vec3) => {
	for (let i = 1; i < 200; i++) {
		v[1] = Math.max(v[1] - 28 * DT, -30);
		if (move(V, p, v, DT)) return i;
	}
	return 0;
};

describe('idx and solid', () => {
	test('x and z wrap and y keeps its own bits', () => {
		expect(idx(-1, 0, 0)).toBe(SIZE - 1);
		expect(idx(SIZE, 0, 0)).toBe(0);
		expect(idx(0, 0, -1)).toBe((SIZE - 1) << 9);
		expect(idx(3, 2, 5)).toBe(3 | (5 << 9) | (2 << 18));
	});

	test('stone below the world, air above it, water never blocks', () => {
		const V = flat(10);
		V[idx(7, 20, 7)] = WATER;
		expect(solid(V, 7, -1, 7)).toBe(true);
		expect(solid(V, 7, 9, 7)).toBe(true);
		expect(solid(V, 7, HEIGHT, 7)).toBe(false);
		expect(solid(V, 7, 20, 7)).toBe(false);
	});
});

describe('move', () => {
	test('falling onto a floor ends on an integer height, grounded', () => {
		const V = flat(10);
		const p: Vec3 = [100.5, 14.37, 100.5];
		expect(fall(V, p, [0, 0, 0])).toBeGreaterThan(0);
		expect(p[1]).toBe(10);
	});

	test('a wall stops the walk and zeroes the velocity', () => {
		const V = flat(10);
		for (let y = 10; y < 13; y++) V[idx(103, y, 100)] = STONE;
		const p: Vec3 = [100.5, 10, 100.5];
		const v: Vec3 = [4.3, 0, 0];
		for (let i = 0; i < 100; i++) move(V, p, v, DT);
		expect(p[0]).toBeLessThanOrEqual(102.7);
		expect(p[0]).toBeGreaterThan(102.5);
		expect(v[0]).toBe(0);
	});

	test('a ceiling zeroes the upward velocity', () => {
		const V = flat(10);
		V[idx(100, 12, 100)] = STONE;
		const p: Vec3 = [100.5, 10, 100.5];
		const v: Vec3 = [0, 8.5, 0];
		move(V, p, v, DT);
		expect(v[1]).toBe(0);
		expect(p[1]).toBe(10);
	});

	test('walking over the seam wraps to 0 and a wall at x=1 stops it', () => {
		const V = flat(10);
		for (let y = 10; y < 13; y++) V[idx(1, y, 100)] = STONE;
		const p: Vec3 = [SIZE - .5, 10, 100.5];
		const v: Vec3 = [4.3, 0, 0];
		for (let i = 0; i < 100; i++) move(V, p, v, DT);
		expect(p[0]).toBeGreaterThan(.5);
		expect(p[0]).toBeLessThanOrEqual(.7);
	});

	test('a wall at x=0 blocks the approach from x=511', () => {
		const V = flat(10);
		for (let y = 10; y < 13; y++) V[idx(0, y, 100)] = STONE;
		const p: Vec3 = [SIZE - .5, 10, 100.5];
		const v: Vec3 = [4.3, 0, 0];
		for (let i = 0; i < 100; i++) move(V, p, v, DT);
		expect(p[0]).toBeLessThanOrEqual(SIZE - .3);
		expect(p[0]).toBeGreaterThan(SIZE - .5);
	});

	test('falling at the speed cap never ends inside a one block floor', () => {
		const V = new Uint8Array(1 << 24);
		V.fill(STONE, idx(0, 10, 0), idx(0, 11, 0));
		for (let k = 0; k < 20; k++) {
			const p: Vec3 = [100.5, 14 + k * .053, 100.5];
			expect(fall(V, p, [0, -30, 0])).toBeGreaterThan(0);
			expect(p[1]).toBe(11);
			expect(collides(V, p)).toBe(false);
		}
	});
});

describe('collides', () => {
	test('a block inside the box counts, one beside it does not', () => {
		const V = flat(10);
		V[idx(100, 11, 100)] = STONE;
		expect(collides(V, [100.5, 10, 100.5])).toBe(true);
		expect(collides(V, [101.5, 10, 100.5])).toBe(false);
	});

	test('water is not an obstacle', () => {
		const V = flat(10);
		V[idx(100, 11, 100)] = WATER;
		expect(collides(V, [100.5, 10, 100.5])).toBe(false);
	});
});

describe('target', () => {
	const eye: Vec3 = [100.5, 12.5, 95.5];

	test('returns the hit cell and the free cell before it', () => {
		const V = flat(10);
		V[idx(100, 12, 100)] = STONE;
		expect(target(V, eye, [0, 0, 1])).toEqual([idx(100, 12, 100), idx(100, 12, 99)]);
	});

	test('sees nothing past 6 blocks', () => {
		const V = flat(10);
		V[idx(100, 12, 102)] = STONE;
		expect(target(V, [100.5, 12.5, 95.5], [0, 0, 1])).toBeUndefined();
	});

	test('looks through water', () => {
		const V = flat(10);
		V[idx(100, 12, 98)] = WATER;
		V[idx(100, 12, 100)] = STONE;
		expect(target(V, eye, [0, 0, 1])).toEqual([idx(100, 12, 100), idx(100, 12, 99)]);
	});

	test('wraps over the seam', () => {
		const V = flat(10);
		V[idx(1, 12, 100)] = STONE;
		expect(target(V, [SIZE - 1.5, 12.5, 100.5], [1, 0, 0])).toEqual([idx(1, 12, 100), idx(0, 12, 100)]);
	});
});
