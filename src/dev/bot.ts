import { AIR, DIRT, HEIGHT, idx, MASK, WATER, type Vec3 } from '../world.ts';
import { ANY, BLUEPRINTS, type Blueprint } from './blueprints.ts';
import { aim, cellOf, EYE, explore, type Job, jobs, pillar, route, standable, site, stands, supported, unsafe, wrap } from './plan.ts';

/** What the bot needs from the page: wait for the game's next frame, and send a key event to the game's own handlers. */
export interface Io {
	frame(): Promise<void>;
	key(code: string, down: boolean): void;
}

export interface Stats {
	broken: number;
	failures: string[];
	frames: number;
	placed: number;
	scaffold: number;
	teleports: string[];
}

export interface Status extends Stats {
	done: boolean;
	error?: string;
	ms: number;
	origin?: Vec3;
	phase: 'building' | 'clearing' | 'done' | 'error' | 'site';
}

export interface Check {
	expected: number;
	matching: number;
	missing: [x: number, y: number, z: number, want: number, got: number][];
}

/** Frames a jump may take: 0.6 s of air time is about 110 frames at the 180 fps of a headless Chrome. */
const JUMP = 240;

/** Plays the game through its own controls: key events for walking, `dbg.A` for the view, `dbg.act` on the game's own `hit`. */
export class Bot {
	/** Settles when `start` finishes, for tests (a page `evaluate` must never await it). */
	done: Promise<void> = Promise.resolve();
	origin: Vec3 | undefined;
	phase: Status['phase'] = 'site';
	readonly stats: Stats = { broken: 0, failures: [], frames: 0, placed: 0, scaffold: 0, teleports: [] };
	private blueprint: Blueprint | undefined;
	private breaking: ReadonlySet<number> = new Set();
	private error: string | undefined;
	private ended = 0;
	private held = new Set<string>();
	private pin: object | undefined;
	/** Scaffold cells still standing, and every one ever placed. */
	private scaffold: number[] = [];
	private spent: number[] = [];
	private started = 0;

	constructor(
		readonly game: Dbg,
		readonly io: Io,
	) {}

	private fail(message: string) {
		this.stats.failures.push(message);
	}

	private hold(code: string, down = true) {
		this.io.key(code, down);
		if (down) this.held.add(code);
		else this.held.delete(code);
	}

	private stop() {
		for (const code of [...this.held]) this.hold(code, false);
	}

	private async step() {
		await this.io.frame();
		this.stats.frames++;
	}

	private eye(): Vec3 {
		const { P } = this.game;
		return [P[0], P[1] + EYE, P[2]];
	}

	private standing(): Vec3 {
		const { P } = this.game;
		return [Math.floor(P[0]) & MASK, Math.floor(P[1] + .01), Math.floor(P[2]) & MASK];
	}

	async waitFrames(n = 1) {
		for (let i = 0; i < n; i++) await this.step();
	}

	/** Presses the digit key of block `id` (ids 4 to 12 are `Digit1` to `Digit9`, 13 is `Digit0`) and checks that the game selected it. */
	select(id: number) {
		const code = `Digit${(id - 3) % 10}`;
		this.io.key(code, true);
		this.io.key(code, false);
		const got = this.game.select();
		if (got != id) this.fail(`select ${id}: the game selected ${got}`);
		return got == id;
	}

	lookAt(x: number, y: number, z: number) {
		const { A } = this.game;
		const [dx, dy, dz] = [wrap(x - this.game.P[0]), y - this.eye()[1], wrap(z - this.game.P[2])];
		A[0] = Math.atan2(dx, dz);
		A[1] = Math.max(-1.55, Math.min(1.55, Math.atan2(dy, Math.hypot(dx, dz))));
	}

	/** Releases every key and waits until the player stands still on an integer height. */
	private async settle(frames = 90) {
		const { P, v } = this.game;
		this.stop();
		for (let i = 0; i < frames; i++) {
			await this.step();
			if (!v[0] && !v[2] && Number.isInteger(P[1])) return true;
		}
		return false;
	}

	/** Walks the cell centers of `path`, jumping when the next cell is higher or the feet are in water. */
	private async follow(path: Vec3[]) {
		const { A, P, V } = this.game;
		let prevY = Math.floor(P[1] + .01);
		for (const [n, wp] of path.entries()) {
			/** The last cell is reached to within 0.07 so the eye sits where `pillar` and `stands` planned it. */
			const tol = n == path.length - 1 ? .07 : .2;
			let mark = Infinity;
			let jump = 0;
			for (let f = 0; ; f++) {
				const [dx, dz] = [wrap(wp[0] - P[0]), wrap(wp[2] - P[2])];
				const d = Math.hypot(dx, dz);
				if (d < tol && P[1] >= wp[1] - .1) break;
				if (f == 150) return this.stop(), false;
				if (f % 30 == 29) {
					if (mark - d < .05) jump = 8;
					mark = d;
				}
				A[0] = Math.atan2(dx, dz);
				this.hold('KeyW');
				this.hold('Space', wp[1] > prevY || V[idx(...P)] == WATER || jump-- > 0);
				await this.step();
			}
			prevY = wp[1];
		}
		this.stop();
		return true;
	}

	/** Walks to the stand cell `goal` (an `idx`), re-routing up to 3 times, else teleports when allowed. */
	private async walk(goal: number, teleport: boolean) {
		const { P, V, v } = this.game;
		this.pin = undefined;
		const [gx, gy, gz] = cellOf(goal);
		const radius = Math.max(24, Math.ceil(Math.hypot(wrap(gx - P[0]), wrap(gz - P[2])) + 8));
		for (let attempt = 0; attempt < 3; attempt++) {
			const path = route(explore(V, P, radius), goal);
			if (!path) break;
			if (!path.length) path.push([gx + .5, gy, gz + .5]);
			if (await this.follow(path)) return true;
		}
		if (!teleport) return false;
		this.stats.teleports.push(`to ${gx},${gy},${gz} from ${P.map(Math.floor)}`);
		P.splice(0, 3, gx + .5, gy, gz + .5);
		v.fill(0);
		await this.settle();
		return true;
	}

	/** Walks to the stand cell of column (x, z) nearest to the current height, or teleports there. */
	async goto(x: number, z: number, teleport = true) {
		const { P, V } = this.game;
		const [cx, cz] = [Math.floor(x) & MASK, Math.floor(z) & MASK];
		let best = -1;
		for (let y = 0; y < HEIGHT - 1; y++) {
			if (standable(V, cx, y, cz) && (best < 0 || Math.abs(y - P[1]) < Math.abs(best - P[1]))) best = y;
		}
		if (best < 0) return this.fail(`goto ${cx},${cz}: no stand cell`), false;
		return this.walk(idx(cx, best, cz), teleport);
	}

	/** Aims from the actual eye, waits for the game's own `hit` to agree, acts and reports whether the cell holds `want`. */
	private async fire(cell: Vec3, kind: 'break' | 'place', want: number) {
		const { A, V } = this.game;
		for (let tries = 0; tries < 3; tries++) {
			const a = aim(V, this.eye(), cell, kind);
			if (!a) return false;
			A.splice(0, 2, ...a.A);
			await this.step();
			const hit = this.game.hit;
			if (hit?.[0] !== a.hit[0] || hit[1] !== a.hit[1]) continue;
			if (kind == 'place' && this.game.select() != want) this.select(want);
			await this.game.act(kind == 'place' ? 2 : 0);
			return V[idx(...cell)] == want;
		}
		return false;
	}

	/** Places DIRT under the feet `height` times by jumping and placing at the apex. */
	private async pillarUp(height: number) {
		const { A, P, V } = this.game;
		this.select(DIRT);
		A[1] = -1.55;
		for (let i = 0; i < height; i++) {
			const feet = P[1];
			const [below, here] = [idx(P[0], feet - 1, P[2]), idx(P[0], feet, P[2])];
			let placed = false;
			for (let f = 0; f < JUMP && !placed; f++) {
				this.hold('Space');
				await this.step();
				const hit = this.game.hit;
				/** A plant in the feet cell stops the ray itself, and placing over it replaces it. */
				if (P[1] > feet + 1.05 && hit && ((hit[0] == below && hit[1] == here) || hit[0] == here)) {
					await this.game.act(2);
					placed = V[here] == DIRT;
				}
			}
			this.hold('Space', false);
			if (!placed) return this.fail(`pillar at ${cellOf(here)}: no block placed`), false;
			this.scaffold.push(here);
			this.spent.push(here);
			this.stats.scaffold++;
			for (let f = 0; f < JUMP && P[1] != feet + 1; f++) await this.step();
		}
		return true;
	}

	/** Breaks the scaffold from the top while standing on it, one block per landing. */
	async descend() {
		const { A, P, V } = this.game;
		while (this.scaffold.length) {
			const top = this.scaffold.pop()!;
			A[1] = -1.55;
			if (V[top]) {
				await this.step();
				if (this.game.hit?.[0] != top) this.fail(`descend: not standing on ${cellOf(top)}`);
				else await this.game.act(0);
			}
			for (let f = 0; f < JUMP && !(Number.isInteger(P[1]) && !this.game.v[1]); f++) await this.step();
		}
	}

	/** Cells that may hold scaffold: the blueprint wants air there or has nothing. */
	private spare = ([x, y, z]: Vec3) => {
		const [bp, o] = [this.blueprint, this.origin];
		const want = bp && o && bp.cell(wrap(x - o[0]) & MASK, y - o[1], wrap(z - o[2]) & MASK);
		return want === undefined || want === AIR || !bp;
	};

	/** Gets `cell` in aim from where the bot stands, from another stand cell, or from the top of a pillar, then acts. */
	private async reach(cell: Vec3, kind: 'break' | 'place', want: number, tried: Set<number>) {
		const { P, V } = this.game;
		await this.settle();
		if (!unsafe(this.standing(), cell, this.breaking) && (await this.fire(cell, kind, want))) return true;
		await this.descend();
		const map = explore(V, P);
		for (const at of stands(V, map, cell, this.breaking)) {
			const key = idx(...at);
			if (tried.has(key) || !aim(V, [at[0] + .5, at[1] + EYE, at[2] + .5], cell, kind)) continue;
			tried.add(key);
			if (!(await this.walk(key, false)) || !(await this.settle())) continue;
			if (await this.fire(cell, kind, want)) return true;
		}
		const p = pillar(V, cell, kind, map, this.spare, tried);
		if (p) tried.add(p.key);
		if (!p || !(await this.walk(idx(...p.at), false)) || !(await this.settle())) return false;
		return (await this.pillarUp(p.height)) && (await this.fire(cell, kind, want));
	}

	/** Puts `want` (AIR breaks) in the cell: a wrong solid is broken first, the bot moves, builds a pillar or retries as needed. */
	private async work(cell: Vec3, want: number): Promise<boolean> {
		const { V } = this.game;
		const kind = want == AIR ? 'break' : 'place';
		if (V[idx(...cell)] == want) return true;
		if (kind == 'place' && V[idx(...cell)]! > WATER && !(await this.work(cell, AIR))) return false;
		const tried = new Set<number>();
		for (let round = 0; round < 3; round++) {
			if (await this.reach(cell, kind, want, tried)) {
				this.stats[kind == 'place' ? 'placed' : 'broken']++;
				return true;
			}
		}
		return false;
	}

	async place(x: number, y: number, z: number, id: number) {
		const ok = await this.work([x, y, z], id);
		if (!ok) this.fail(`place ${x},${y},${z} ${id}: out of reach or refused`);
		await this.descend();
		return ok;
	}

	async break(x: number, y: number, z: number) {
		const ok = await this.work([x, y, z], AIR);
		if (!ok) this.fail(`break ${x},${y},${z}: out of reach or refused`);
		await this.descend();
		return ok;
	}

	/** Breaks everything in the way top-down, then places the lowest block that touches a solid one, until the blueprint stands. */
	private async build(bp: Blueprint, origin: Vec3) {
		const { P, V } = this.game;
		this.blueprint = bp;
		this.origin = origin;
		const centre: [number, number] = [origin[0] + (bp.size[0] >> 1), origin[2] + (bp.size[2] >> 1)];
		/** The page spawns the player in the air, the fall takes up to a few hundred frames. */
		await this.settle(600);
		const map = explore(V, P, Math.max(24, Math.ceil(Math.hypot(wrap(centre[0] - P[0]), wrap(centre[1] - P[2])) + 16)));
		let near: number | undefined;
		for (const [k, [cost]] of map) {
			const at = cellOf(k);
			if (Math.hypot(wrap(at[0] - centre[0]), wrap(at[2] - centre[1])) <= 7 && (near === undefined || cost < map.get(near)![0])) near = k;
		}
		if (near === undefined || !(await this.walk(near, false))) throw new Error('the site is not reachable on foot');
		/** Jobs that failed since the last success, retried once another cell of the tier gave them a neighbour to lean on. */
		const deferred = new Set<number>();
		for (let n = 0; n < 4000; n++) {
			const todo = jobs(V, bp, origin).filter(j => !this.scaffold.includes(idx(...j.cell)));
			if (!todo.length) break;
			this.breaking = new Set(todo.filter(j => j.want == AIR).map(j => idx(...j.cell)));
			let tier: Job[];
			if (this.breaking.size) {
				this.phase = 'clearing';
				const top = Math.max(...todo.filter(j => j.want == AIR).map(j => j.cell[1]));
				tier = todo.filter(j => j.want == AIR && j.cell[1] == top);
			} else {
				this.phase = 'building';
				const open = todo.filter(j => supported(V, j.cell));
				const low = Math.min(...open.map(j => j.cell[1]));
				tier = open.filter(j => j.cell[1] == low);
			}
			if (!tier.length) throw new Error('no cell of the blueprint touches a solid block');
			await this.settle();
			const live = tier.filter(j => !deferred.has(idx(...j.cell)));
			if (!live.length) {
				for (const { cell, want } of tier) this.fail(`${want == AIR ? 'break' : 'place'} ${cell} ${want}: out of reach or refused`);
				throw new Error(`gave up on ${tier[0]!.cell} ${tier[0]!.want}`);
			}
			const kindOf = (j: Job) => (j.want == AIR ? 'break' : 'place');
			const dist = (j: Job) => Math.hypot(wrap(j.cell[0] - P[0]), j.cell[1] - P[1], wrap(j.cell[2] - P[2]));
			const ready = live.find(j => !unsafe(this.standing(), j.cell, this.breaking) && aim(V, this.eye(), j.cell, kindOf(j)));
			const job = ready ?? live.reduce((a, b) => (dist(b) < dist(a) ? b : a));
			if (await this.work(job.cell, job.want)) deferred.clear();
			else deferred.add(idx(...job.cell));
		}
		await this.descend();
		this.stop();
	}

	/** Starts building blueprint `name` at the best site near the given point (the player by default), poll `status()`. */
	start(name: string, near: [number, number] = [this.game.P[0], this.game.P[2]]) {
		const bp = BLUEPRINTS[name];
		if (!bp) throw new Error(`no blueprint ${name}`);
		this.started = performance.now();
		this.phase = 'site';
		this.done = (async () => {
			const origin = site(this.game.V, near, bp);
			if (!origin) throw new Error(`no flat dry site near ${near}`);
			await this.build(bp, origin);
			this.phase = 'done';
		})()
			.catch(e => {
				this.error = String(e);
				this.phase = 'error';
			})
			.finally(() => (this.ended = performance.now()));
	}

	status(): Status {
		const done = this.phase == 'done' || this.phase == 'error';
		return { ...this.stats, done, error: this.error, ms: Math.round((done ? this.ended : performance.now()) - this.started), origin: this.origin, phase: this.phase };
	}

	/** Reads the world at every blueprint cell and every scaffold cell ever placed, independently of the bot's own bookkeeping. */
	check(name: string, origin: Vec3): Check {
		const bp = BLUEPRINTS[name]!;
		const { V } = this.game;
		const missing: Check['missing'] = [];
		let expected = 0;
		for (let y = 0; y < bp.size[1]; y++) {
			for (let z = 0; z < bp.size[2]; z++) {
				for (let x = 0; x < bp.size[0]; x++) {
					const want = bp.cell(x, y, z)!;
					const got = V[idx(origin[0] + x, origin[1] + y, origin[2] + z)]!;
					expected++;
					if (want == ANY ? got <= WATER : got != want) missing.push([(origin[0] + x) & MASK, origin[1] + y, (origin[2] + z) & MASK, want, got]);
				}
			}
		}
		for (const i of this.spent) {
			expected++;
			if (V[i]) missing.push([...cellOf(i), AIR, V[i]!]);
		}
		return { expected, matching: expected - missing.length, missing };
	}

	/** Highest y with a block above water, so the underwater views stand on the lake bottom. */
	top(x: number, z: number) {
		let y = HEIGHT - 1;
		while (y > 0 && this.game.V[idx(x, y, z)]! <= WATER) y--;
		return y;
	}

	/** Stands on the ground of column (x, z), looking along `yaw` and `pitch`, with the sun clock at `time` (noon 121, sunset 271, night 421). */
	at(x: number, z: number, yaw: number, pitch: number, time = 121) {
		this.pin = undefined;
		this.game.P.splice(0, 3, x, this.top(x, z) + 1, z);
		this.game.A.splice(0, 2, yaw, pitch);
		this.game.time(time);
	}

	/** Holds the camera in the air at (x, y, z) on every frame, against gravity, until a movement or `at` takes over. */
	fly(x: number, y: number, z: number, yaw: number, pitch: number, time = 121) {
		const pin = (this.pin = {});
		this.game.A.splice(0, 2, yaw, pitch);
		this.game.time(time);
		void (async () => {
			while (this.pin == pin) {
				this.game.P.splice(0, 3, x, y, z);
				this.game.v.fill(0);
				await this.io.frame();
			}
		})();
	}
}
