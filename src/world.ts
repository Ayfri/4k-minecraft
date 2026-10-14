/** Numeric exports are substituted by name into `shader.wgsl` at build time. */
export const SIZE = 512;
export const MASK = SIZE - 1;
export const HEIGHT = 64;
export const TOP = HEIGHT - 1;
export const SEA = 24;
/** Highest column that gets a beach and no trees. */
export const SHORE = SEA + 1;
export const AIR = 0;
/** Flowers are the one non-solid block a ray stops at (a cutout texture), every block above WATER is solid. */
export const FLOWER = 1;
export const WATER = 2;
export const GRASS = 3;
export const DIRT = 4;
export const STONE = 5;
export const SAND = 6;
export const LOG = 7;
export const LEAVES = 8;
export const PLANKS = 9;
export const BRICKS = 10;
export const SNOW = 11;
export const COAL = 12;
export const IRON = 13;
export const DIAMOND = 14;
export const BLOCKS = 15;

/** Voxel index of a position, one byte per cell. x and z wrap by bitmask, y at or past HEIGHT lands past the buffer. The bitwise operators truncate, so x and z shift by SIZE first to floor down to -SIZE. */
export const idx = (x: number, y: number, z: number) => (MASK & (x + SIZE)) | ((MASK & (z + SIZE)) << 9) | (y << 18);

export type Vec3 = [number, number, number];

/** Stone below the world, air above it (the lookup lands past the buffer, `undefined > WATER` is false), water and flowers never block. */
export const solid = (V: Uint8Array, x: number, y: number, z: number) => y < 0 || V[idx(x, y, z)]! > WATER;

/** Whether the 0.6 x 1.8 box standing on the feet position `p` overlaps a solid cell. The samples are 0.9 apart on y so no cell is skipped. */
export const collides = (V: Uint8Array, p: Vec3) => {
	for (let i = 0; i < 12; i++) {
		if (solid(V, p[0] + (i & 1) * .6 - .3, p[1] + (i % 3) * .9, p[2] + +(i > 5) * .6 - .3)) return true;
	}
	return false;
};

/** Moves `p` by `v * dt` one axis at a time, zeroing the velocity it hits, and wraps it into [0, SIZE) (y stays under HEIGHT). Returns whether the feet landed. A step must stay under one block: `dt <= .03` with `v[1] >= -30`. */
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

/** Marches 6 blocks along `dir` from `eye` and returns the voxel index of the first solid cell and of the cell before it (-1 when the eye is inside). */
export const target = (V: Uint8Array, eye: Vec3, dir: Vec3): [hit: number, place: number] | undefined => {
	let place = -1;
	for (let t = 0; t < 6; t += .02) {
		const i = idx(eye[0] + dir[0] * t, eye[1] + dir[1] * t, eye[2] + dir[2] * t);
		if (V[i]! > WATER) return [i, place];
		place = i;
	}
};
