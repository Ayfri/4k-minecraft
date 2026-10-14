/** Numeric exports are substituted by name into `shader.wgsl` at build time. */
export const SIZE = 512;
export const MASK = SIZE - 1;
export const HEIGHT = 64;
export const TOP = HEIGHT - 1;

export const AIR = 0;
export const WATER = 1;
export const GRASS = 2;
export const DIRT = 3;
export const STONE = 4;
export const SAND = 5;
export const LOG = 6;
export const LEAVES = 7;
export const PLANKS = 8;
export const BRICKS = 9;
export const SNOW = 10;
export const COAL = 11;
export const IRON = 12;
export const DIAMOND = 13;
export const BLOCKS = 14;

/** Voxel index, one byte per cell. x and z wrap by bitmask, y must already be in [0, HEIGHT). */
export const idx = (x: number, y: number, z: number) => (x & MASK) | ((z & MASK) << 9) | (y << 18);
