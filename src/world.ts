/** Numeric exports are substituted by name into `shader.wgsl` at build time. */
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

/** Moves `p` by `v * dt` per axis, zeroing blocked velocity, wraps x and z, returns whether the feet landed (needs `dt <= .03`). */
export const move = (V: Uint8Array, p: Vec3, v: Vec3, dt: number) => {
	let ground = false;
	for (const a of [0, 1, 2] as const) {
		p[a] += v[a] * dt;
		if (collides(V, p)) {
			if (a == 1 && v[1] < 0) {
				p[1] = Math.ceil(p[1]);
				ground = true;
			} else p[a] -= v[a] * dt;
			v[a] = 0;
		}
		p[a] = (p[a] + SIZE) % SIZE;
	}
	return ground;
};

/** Next vertical velocity: Space jumps from the ground or out of water (feet in a water cell), water sinks slowly, air falls fast. */
export const lift = (V: Uint8Array, p: Vec3, vy: number, dt: number, jump: number, ground: boolean) => {
	const swim = V[idx(...p)] == WATER;
	return jump && (ground || swim) ? 8.5 : swim ? Math.max(vy - 8.4 * dt, -2) : Math.max(vy - 28 * dt, -30);
};

/** Marches 6 blocks along `dir` from `eye`, returns the first solid or plant cell and the cell before it (-1 when the eye is inside). */
export const target = (V: Uint8Array, eye: Vec3, dir: Vec3): [hit: number, place: number] | undefined => {
	let place = -1;
	for (let t = 0; t < 6; t += .02) {
		const i = idx(eye[0] + dir[0] * t, eye[1] + dir[1] * t, eye[2] + dir[2] * t);
		if (V[i]! && V[i]! - WATER) return [i, place];
		place = i;
	}
};
