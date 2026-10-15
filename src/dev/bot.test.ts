import { describe, expect, test } from 'bun:test';
import { BYTES, collides, DIRT, FLOWER, GLASS, GRASS, idx, LAYER, LEAVES, LOG, lift, move, SIZE, STONE, target, type Vec3, WATER } from '../world.ts';
import { Bot } from './bot.ts';
/** Mirrors the player step and the click of the shader and the digit rule of `main.ts` (the keys, `lift`, `move`, `target`, the `collides` revert), driven one fixed step at a time. */
class FakeGame implements Dbg {
	A: [number, number] = [0, 0];
	readonly drift = { frames: 0, hits: 0, max: 0 };
	V: Uint8Array;
	P: Vec3;
	v: Vec3 = [0, 0, 0];
	private current: [number, number] | undefined;
	private ground = 0;
	private keys: Record<string, boolean> = {};
	private selected = GRASS;

	constructor(
		V: Uint8Array,
		P: Vec3,
		readonly dt = .016,
		readonly shift = GRASS - 1,
	) {
		this.V = V;
		this.P = P;
	}

	get hit() {
		return this.current;
	}

	act(button: number) {
		if (!this.current) return;
		const { P, V } = this;
		const [i, free] = this.current;
		if (button < 2) return (V[i] = 0), V[i + LAYER]! < WATER && (V[i + LAYER] = 0);
		const cell = V[i]! < WATER ? i : free;
		const old = V[cell]!;
		if (old <= WATER) {
			V[cell] = this.selected;
			if (collides(V, P)) V[cell] = old;
		}
	}

	bench = async () => 0;

	key(code: string, down: boolean) {
		this.keys[code] = down;
		this.selected = ((+code[5]! + 9) % 10) + 1 + this.shift || this.selected;
	}

	select(block = this.selected) {
		return (this.selected = block);
	}

	/** The wheel of `main.ts`: the next id for a positive `deltaY`, else the previous one, over the ids 1 to 17 without air (0) and water (4), wrapping. */
	wheel(deltaY: number) {
		do this.selected = (this.selected + (deltaY > 0 ? 1 : 17)) % 18;
		while (17 >> this.selected & 1);
		return this.selected;
	}

	sync = async () => {};

	time = (seconds: number) => seconds;

	step() {
		const { A, P, V, v, dt } = this;
		const key = (code: string) => +!!this.keys[code];
		const [sy, sp] = A.map(Math.sin) as typeof A;
		const [cy, cp] = A.map(Math.cos) as typeof A;
		const [fw, rt] = [key('KeyW') * (1 + key('ShiftLeft') * .3) - key('KeyS'), key('KeyD') - key('KeyA')];
		const speed = V[idx(...P)] == WATER ? 1.7 : 4.3;
		v[0] = (fw * sy + rt * cy) * speed;
		v[2] = (fw * cy - rt * sy) * speed;
		v[1] = lift(V, P, v[1], dt, key('Space'), this.ground);
		this.ground = move(V, P, v, dt);
		this.current = target(V, [P[0], P[1] + 1.62, P[2]], [sy * cp, sp, cy * cp]);
	}
}

/** Dirt with a grass top, the top cell is `floor - 1` and the feet stand at `floor`. */
const flat = (floor: number) => new Uint8Array(BYTES).fill(DIRT, 0, idx(0, floor - 1, 0)).fill(GRASS, idx(0, floor - 1, 0), idx(0, floor, 0));

const setup = (V: Uint8Array, P: Vec3, dt = .016, shift = GRASS - 1) => {
	const game = new FakeGame(V, P, dt, shift);
	return { bot: new Bot(game, { frame: async () => game.step(), key: (code, down) => game.key(code, down) }), game };
};

const DTS = [.016, .03];

describe.each(DTS)('bot at dt %f', dt => {
	test('goto walks flat ground without teleporting', async () => {
		const { bot, game } = setup(flat(20), [100.5, 20, 100.5], dt);
		expect(await bot.goto(108.5, 96.5)).toBe(true);
		expect(Math.hypot(game.P[0] - 108.5, game.P[2] - 96.5)).toBeLessThan(.25);
		expect(bot.stats.teleports).toEqual([]);
	});

	test('goto jumps a one block step and walks around a two block wall', async () => {
		const V = flat(20);
		V[idx(103, 20, 100)] = STONE;
		for (let z = 97; z <= 103; z++) V[idx(106, 20, z)] = V[idx(106, 21, z)] = STONE;
		const { bot, game } = setup(V, [100.5, 20, 100.5], dt);
		expect(await bot.goto(103.5, 100.5)).toBe(true);
		await bot.waitFrames(60);
		expect(game.P[1]).toBe(21);
		expect(await bot.goto(109.5, 100.5)).toBe(true);
		expect(Math.hypot(game.P[0] - 109.5, game.P[2] - 100.5)).toBeLessThan(.25);
		expect(bot.stats.teleports).toEqual([]);
	});

	test('goto swims across a water channel', async () => {
		const V = flat(20);
		for (let z = 80; z < 120; z++) for (let x = 104; x < 107; x++) V[idx(x, 18, z)] = V[idx(x, 19, z)] = WATER;
		const { bot, game } = setup(V, [100.5, 20, 100.5], dt);
		expect(await bot.goto(110.5, 100.5)).toBe(true);
		expect(game.P[0]).toBeGreaterThan(110.2);
		expect(bot.stats.teleports).toEqual([]);
	});

	test('goto crosses the x seam', async () => {
		const { bot, game } = setup(flat(20), [SIZE - 3.5, 20, 100.5], dt);
		expect(await bot.goto(4.5, 100.5)).toBe(true);
		expect(Math.hypot(game.P[0] - 4.5, game.P[2] - 100.5)).toBeLessThan(.25);
	});

	test('goto into a sealed box teleports by default, or says no', async () => {
		const V = flat(20);
		for (let x = 109; x <= 111; x++) for (let z = 109; z <= 111; z++) for (let y = 20; y < 24; y++) V[idx(x, y, z)] = x == 110 && z == 110 && y < 22 ? 0 : STONE;
		const { bot, game } = setup(V, [100.5, 20, 100.5], dt);
		expect(await bot.goto(110.5, 110.5, false)).toBe(false);
		expect(bot.stats.teleports).toEqual([]);
		expect(await bot.goto(110.5, 110.5)).toBe(true);
		expect(bot.stats.teleports).toHaveLength(1);
		expect(game.P.slice(0, 1)).toEqual([110.5]);
	});

	test('placing into the cell the player stands in moves the player first', async () => {
		const { bot, game } = setup(flat(20), [100.5, 20, 100.5], dt);
		expect(await bot.place(100, 20, 100, STONE)).toBe(true);
		expect(game.V[idx(100, 20, 100)]).toBe(STONE);
		expect(collides(game.V, game.P)).toBe(false);
		expect(bot.stats.failures).toEqual([]);
	});

	test('placing high on a tower pillars up and takes the scaffold away', async () => {
		const V = flat(20);
		for (let y = 20; y < 29; y++) V[idx(101, y, 100)] = STONE;
		const { bot, game } = setup(V, [100.5, 20, 100.5], dt);
		expect(await bot.place(100, 28, 100, STONE)).toBe(true);
		expect(game.V[idx(100, 28, 100)]).toBe(STONE);
		expect(bot.stats.scaffold).toBeGreaterThan(0);
		expect(game.V.subarray(idx(0, 20, 0), idx(0, 31, 0)).includes(DIRT)).toBe(false);
		expect(bot.stats.failures).toEqual([]);
	});

	test('breaking a block takes the plant above it', async () => {
		const V = flat(20);
		V[idx(101, 19, 100)] = 0;
		V[idx(100, 20, 100)] = FLOWER;
		const { bot, game } = setup(V, [98.5, 20, 100.5], dt);
		expect(await bot.break(100, 19, 100)).toBe(true);
		expect(game.V[idx(100, 19, 100)]).toBe(0);
		expect(game.V[idx(100, 20, 100)]).toBe(0);
	});

	test.each([0, 7])('the full house on a flat world, trees every %i blocks', async spacing => {
		const V = flat(20);
		for (let x = 56; spacing && x < 150; x += spacing) {
			for (let z = 56; z < 150; z += spacing) {
				V[idx(x, 20, z)] = V[idx(x, 21, z)] = LOG;
				for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) V[idx(x + a, 22, z + b)] = LEAVES;
			}
		}
		const { bot, game } = setup(V, [100.5, 20, 100.5], dt);
		bot.start('house', [100, 100]);
		await bot.done;
		const status = bot.status();
		const check = bot.check('house', status.origin!);
		console.log(`dt ${dt}: ${status.frames} frames, placed ${status.placed}, broken ${status.broken}, scaffold ${status.scaffold}, ${status.ms} ms, failures ${status.failures.join(' | ')}`);
		expect(status.error).toBeUndefined();
		expect(check.missing).toEqual([]);
		expect(check.matching).toBe(check.expected);
		expect(status.teleports).toEqual([]);
		expect(status.failures).toEqual([]);
		expect(collides(game.V, game.P)).toBe(false);
	}, 120000);
});

test('select with a drifted digit mapping records a failure', () => {
	const { bot } = setup(flat(20), [100.5, 20, 100.5], .016, 2);
	expect(bot.select(STONE)).toBe(false);
	expect(bot.stats.failures).toHaveLength(1);
	expect(setup(flat(20), [100.5, 20, 100.5]).bot.select(STONE)).toBe(true);
});

test('the wheel cycles every placeable id in both directions and skips air and water', () => {
	const { game } = setup(flat(20), [100.5, 20, 100.5]);
	const ids = [1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
	game.select(1);
	expect(ids.map(() => game.wheel(1))).toEqual([...ids.slice(1), 1]);
	expect(ids.map(() => game.wheel(-1))).toEqual(ids.toReversed());
});

test('select reaches every digit key, 0 is glass, other keys keep the block', () => {
	const { bot, game } = setup(flat(20), [100.5, 20, 100.5]);
	for (let id = GRASS; id <= GLASS; id++) expect(bot.select(id)).toBe(true);
	game.key('KeyW', true);
	game.key('Space', true);
	expect(game.select()).toBe(GLASS);
});
