import { AIR, BRICKS, GLASS, LOG, PLANKS, STONE, type Vec3 } from '../world.ts';

/** Any solid cell, the builder fills it with GRASS at local y 0 and DIRT below. */
export const ANY = -1;

export interface Blueprint {
	/** Wanted block at local (x, y, z), `undefined` outside the box. */
	cell(x: number, y: number, z: number): number | undefined;
	name: string;
	size: Vec3;
}

/** Roof columns per layer starting at local y 5, two per slope so every row leans on a built neighbour. */
const ROOF = [[0, 1, 7, 8], [1, 2, 6, 7], [2, 3, 5, 6], [3, 4, 5]];
/** Plank span of the gable ends (z 1 and 7) per layer starting at local y 5. */
const GABLE = [[2, 6], [3, 5], [4, 4]];
const WINDOWS = ['2,2,1', '6,2,1', '1,2,4', '7,2,4', '4,2,7'];

/** 9x9x9 box, local y 0 is the ground layer: floor flush with the grass, stone course, plank walls, log corners, glass windows, brick gable roof. */
const house: Blueprint = {
	cell(x, y, z) {
		if (Math.min(x, y, z) < 0 || Math.max(x, y, z) > 8) return;
		const wall = x >= 1 && x <= 7 && z >= 1 && z <= 7;
		const border = wall && (x == 1 || x == 7 || z == 1 || z == 7);
		if (y == 0) return wall ? (border ? STONE : PLANKS) : ANY;
		if (y < 5) {
			if (WINDOWS.includes(`${x},${y},${z}`)) return GLASS;
			if (!border || (x == 4 && z == 1 && y < 3)) return AIR;
			return (x == 1 || x == 7) && (z == 1 || z == 7) ? LOG : y == 1 ? STONE : PLANKS;
		}
		if (ROOF[y - 5]!.includes(x)) return BRICKS;
		const gable = GABLE[y - 5];
		return gable && (z == 1 || z == 7) && x >= gable[0]! && x <= gable[1]! ? PLANKS : AIR;
	},
	name: 'house',
	size: [9, 9, 9],
};

export const BLUEPRINTS: Record<string, Blueprint> = { house };
