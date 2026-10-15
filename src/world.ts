/** Numeric exports are substituted by name into `shader.wgsl` at build time. The functions are the CPU reference of the shader's player step and targeting (`tick`, `hits`, `M`), never shipped: the tests, the bot planner and the DEV drift check use them. */
export const SIZE = 1024;
export const MASK = SIZE - 1;
export const HEIGHT = 128;
export const TOP = HEIGHT - 1;
/** Voxel index step of one y level, and the world size in bytes (2^27, exactly the default `maxStorageBufferBindingSize`). */
export const LAYER = SIZE * SIZE;
export const BYTES = LAYER * HEIGHT;
export const SEA = 44;
/** Highest column that gets a beach and no trees. */
export const SHORE = SEA + 1;
export const AIR = 0;
/** Plants (flowers, tufts) have no collision, `target` stops at them to break or replace them, the shader's march only stops on opaque texels. */
export const FLOWER = 1;
export const TUFT = 2;
export const WATER = 3;
export const GRASS = 4;
export const DIRT = 5;
export const STONE = 6;
export const SAND = 7;
export const LOG = 8;
export const LEAVES = 9;
export const PLANKS = 10;
export const BRICKS = 11;
export const SNOW = 12;
/** Solid for physics and `target`, the shader's march only stops on its frame and streak texels. */
export const GLASS = 13;
export const COAL = 14;
export const IRON = 15;
export const DIAMOND = 16;
/** Unbreakable floor: the whole bottom layer, then cells of the 3 layers above with a chance of 75, 50 and 25%. */
export const BEDROCK = 17;

/** Voxel index, one byte per cell: x and z wrap by bitmask (the SIZE shift floors negatives), y past HEIGHT is out of range. */
export const idx = (x: number, y: number, z: number) => (MASK & (x + SIZE)) | ((MASK & (z + SIZE)) << 10) | (y << 20);

export type Vec3 = [number, number, number];

/** Stone below the world, air above it (the lookup lands past the buffer, `undefined > WATER` is false), water and plants pass. */
export const solid = (V: Uint8Array, x: number, y: number, z: number) => y < 0 || V[idx(x, y, z)]! > WATER;

/** Whether the 0.6 x 1.8 box standing on the feet position `p` overlaps a solid cell, sampled 0.9 apart on y so no cell is skipped. */
export const collides = (V: Uint8Array, p: Vec3) => {
	for (let i = 0; i < 12; i++) {
		if (solid(V, p[0] + (i & 1) * .6 - .3, p[1] + (i % 3) * .9, p[2] + +(i > 5) * .6 - .3)) return true;
	}
	return false;
};

/** Moves `p` by `v * dt` per axis, zeroing blocked velocity, wraps x and z, returns the contact: 2 when the feet landed, 1 against a wall (`~a & 1`, a ceiling does not count), 0 otherwise (needs `dt <= .03`). */
export const move = (V: Uint8Array, p: Vec3, v: Vec3, dt: number) => {
	let contact = 0;
	for (const a of [0, 1, 2] as const) {
		p[a] += v[a] * dt;
		if (collides(V, p)) {
			if (a == 1 && v[1] < 0) {
				p[1] = Math.ceil(p[1]);
				contact = 2;
			} else (p[a] -= v[a] * dt), (contact ||= ~a & 1);
			v[a] = 0;
		}
		p[a] = (p[a] + SIZE) % SIZE;
	}
	return contact;
};

/** Next vertical velocity: Space jumps from the ground, or in water (feet in a water cell) swims up slowly and jumps out against a wall, water sinks slowly, air falls fast. */
export const lift = (V: Uint8Array, p: Vec3, vy: number, dt: number, jump: number, contact: number) => {
	const swim = V[idx(...p)] == WATER;
	return swim ? (jump ? (contact ? 8.5 : 3) : Math.max(vy - 8.4 * dt, -2)) : jump && contact > 1 ? 8.5 : Math.max(vy - 28 * dt, -30);
};

/**
 * The reference of the targeting march of the shader (`M` with under 99 steps): an exact cell walk along `dir` from `eye`, returns the first cell that is neither air nor water
 * (stone below the world) whose entry is within 6 blocks, and the cell the ray came from (the hit cell itself when the eye is inside it).
 */
export const target = (V: Uint8Array, eye: Vec3, dir: Vec3): [hit: number, place: number] | undefined => {
	const cell = eye.map(Math.floor) as Vec3;
	const step = dir.map(Math.sign);
	const r = dir.map(d => 1 / (Math.abs(d) + 1e-6));
	const e = r.map((k, a) => (step[a]! * (cell[a]! - eye[a]! + .5) + .5) * k);
	let axis = -1;
	for (let i = 0; i < 16; i++) {
		const t = axis < 0 ? 0 : e[axis]! - r[axis]!;
		if (t >= 6) return;
		const block = cell[1]! < 0 ? STONE : cell[1]! > TOP ? 0 : V[idx(...cell)]!;
		const at = idx(cell[0]!, cell[1]! & TOP, cell[2]!);
		if (block && block != WATER) {
			if (axis < 0) return [at, at];
			cell[axis]! -= step[axis]!;
			return [at, idx(cell[0]!, cell[1]! & TOP, cell[2]!)];
		}
		axis = e[0]! < e[1]! && e[0]! <= e[2]! ? 0 : e[1]! <= e[2]! ? 1 : 2;
		e[axis]! += r[axis]!;
		cell[axis]! += step[axis]!;
	}
};
