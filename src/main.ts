import shader from './shader.wgsl' with { type: 'text' };
import { BYTES, idx, LAYER, lift, move, target, WATER, type Vec3 } from './world.ts';

/** Yaw and pitch, the shader derives the view direction and the walk direction from them. */
const A: [number, number] = [-1.7, -.02];
/** Milliseconds added to the page clock, set by `dbg.time`. */
let clock = 0;
let keys: Record<string, boolean> = {};

c.style = 'position:fixed;inset:0';

const device = await (await navigator.gpu.requestAdapter())!.requestDevice();
const ctx = c.getContext('webgpu')!;
/** Usage 8 is STORAGE_BINDING: the compute shader writes each frame straight into the canvas texture (`bgra8unorm` would need a device feature). */
ctx.configure({ device, format: 'rgba8unorm', usage: 8 });
const module = device.createShaderModule({ code: shader });

/** The voxels, one byte per cell, and the 32 bytes of player state: the shader owns both, DEV reads them back (usage 4 is COPY_SRC, 8 COPY_DST). */
const world = device.createBuffer({ size: BYTES, usage: DEV ? 140 : 128 });
const state = device.createBuffer({ size: 32, usage: DEV ? 140 : 128 });
const pipeline = device.createComputePipeline({ compute: { module }, layout: 'auto' });

/** The `Uniforms` immediates: view angles, canvas size (0 while the world generates), forward, right, jump, click, time and frame time in seconds. */
const data = new Float32Array(10);

/** Encodes one pass: the player step in a lone workgroup, then `g` over `x` by `y` workgroups (the world gen or the render). */
const run = (x: number, y = 1) => {
	const encoder = device.createCommandEncoder();
	const pass = encoder.beginComputePass();
	pass.setPipeline(pipeline);
	pass.setBindGroup(0, device.createBindGroup({ entries: [{ binding: 0, resource: world }, { binding: 1, resource: ctx.getCurrentTexture() }, { binding: 2, resource: state }], layout: pipeline.getBindGroupLayout(0) }));
	pass.setImmediates(0, data);
	pass.dispatchWorkgroups(1);
	pass.dispatchWorkgroups(x, y);
	pass.end();
	device.queue.submit([encoder.finish()]);
};

const t0 = DEV ? performance.now() : 0;
run(4096);

const draw = () => run(c.width / 64 + 1, c.height);

/** Block placed by the right button, picked with the digit keys (ids 4 to 13, `Digit1` is grass and `Digit0` the tenth, glass). */
let selected = 4;
/** The click of the next frame for the shader: -1 breaks the target and the plant above it, else the block to place in the free cell or over a plant. */
let click = 0;
onkeydown = onkeyup = e => ((keys[e.code] = e.type < 'keyu'), (selected = ((+e.code[5]! + 9) % 10) + 4 || selected));
onmousedown = e => (document.pointerLockElement ? (click = e.button < 2 ? -1 : selected) : c.requestPointerLock({ unadjustedMovement: true }));
oncontextmenu = () => !1;
onblur = () => (keys = {});
onmousemove = e => {
	if (!document.pointerLockElement) return;
	A[0] += e.movementX * .002;
	A[1] = Math.max(-1.55, Math.min(1.55, A[1] - e.movementY * .002));
};

/** DEV: steps the CPU reference of the shader physics with the immediates of each frame. */
let devFrame: ((d: Float32Array) => void) | undefined;
let last = 0;
const frame = (now: number) => {
	c.width = innerWidth;
	c.height = innerHeight;
	data.set([...A, c.width, c.height, +!!keys.KeyW - +!!keys.KeyS, +!!keys.KeyD - +!!keys.KeyA, +!!keys.Space, click, (DEV ? now + clock : now) / 1e3, Math.min(now - last, 30) / 1e3]);
	if (DEV) devFrame?.(data);
	click = 0;
	last = now;
	draw();
	requestAnimationFrame(frame);
};

if (DEV) {
	device.onuncapturederror = e => console.error(e.error.message);
	for (const m of (await module.getCompilationInfo()).messages) console.log(`wgsl ${m.type} ${m.lineNum}: ${m.message}`);
	console.log(`gen ${(performance.now() - t0).toFixed(1)} ms`);

	/** Copies `ranges` of `buffer` (offsets and sizes in multiples of 4) to the CPU, back to back. */
	const read = async (buffer: GPUBuffer, ...ranges: [offset: number, size: number][]) => {
		const stage = device.createBuffer({ size: ranges.reduce((total, [, size]) => total + size, 0), usage: 9 });
		const encoder = device.createCommandEncoder();
		let at = 0;
		for (const [offset, size] of ranges) encoder.copyBufferToBuffer(buffer, offset, stage, (at += size) - size, size);
		device.queue.submit([encoder.finish()]);
		await stage.mapAsync(1);
		const bytes = new Uint8Array(stage.getMappedRange().slice(0));
		stage.destroy();
		return bytes;
	};

	/** The CPU copy of the world, mapped once after the generation and patched around every edit. */
	const full = device.createBuffer({ size: BYTES, usage: 9 });
	const encoder = device.createCommandEncoder();
	encoder.copyBufferToBuffer(world, full, BYTES);
	device.queue.submit([encoder.finish()]);
	await full.mapAsync(1);
	const V = new Uint8Array(full.getMappedRange());
	const patch = async (cells: number[]) => {
		const words = [...new Set(cells.filter(i => i < BYTES).map(i => i & ~3))];
		const bytes = await read(world, ...words.map((i): [number, number] => [i, 4]));
		words.forEach((i, n) => V.set(bytes.subarray(n * 4, n * 4 + 4), i));
	};

	/** The feet, the velocity and the targeted cell with its free cell, refreshed by `sync` from the shader state and the CPU copy. */
	const P: Vec3 = [434.5, 100, 511.5];
	const v: Vec3 = [0, 0, 0];
	let hit: [number, number] | undefined;
	let seen: Vec3 = [...P];
	/** The CPU reference physics (`world.ts`) fed with the same inputs, `drift` is the largest gap to the shader seen, `hits` the frames where the targeted cells differ. */
	const ref = { ground: 0, P: [...P] as Vec3, v: [0, 0, 0] as Vec3 };
	const drift = { frames: 0, hits: 0, max: 0 };
	devFrame = d => {
		const [sy, cy] = [Math.sin(d[0]!), Math.cos(d[0]!)];
		const speed = V[idx(...ref.P)] == WATER ? 1.7 : 4.3;
		ref.v[0] = (d[4]! * sy + d[5]! * cy) * speed;
		ref.v[2] = (d[4]! * cy - d[5]! * sy) * speed;
		ref.v[1] = lift(V, ref.P, ref.v[1], d[9]!, d[6]!, ref.ground);
		ref.ground = move(V, ref.P, ref.v, d[9]!);
		[v[0], v[2]] = [ref.v[0], ref.v[2]];
	};

	const sync = async () => {
		if (P.some((x, i) => x != seen[i])) {
			device.queue.writeBuffer(state, 0, new Float32Array([...P, v[1]]));
			ref.P = [...P];
			ref.v = [0, v[1], 0];
			ref.ground = 0;
		}
		/** The copy is queued before the first await, so a frame during the readback is not in it. */
		const mirror = [...ref.P];
		const f = new Float32Array((await read(state, [0, 32])).buffer);
		P.splice(0, 3, (f[0]! + 1024) % 1024, f[1]!, (f[2]! + 1024) % 1024);
		v[1] = f[3]!;
		seen = [...P];
		const wrap = (x: number) => ((x + 512) % 1024 + 1024) % 1024 - 512;
		drift.frames++;
		drift.max = Math.max(drift.max, ...P.map((x, a) => Math.abs(a == 1 ? x - mirror[1]! : wrap(x - mirror[a]!))));
		const [sy, sp] = A.map(Math.sin) as typeof A;
		const [cy, cp] = A.map(Math.cos) as typeof A;
		hit = target(V, [P[0], P[1] + 1.62, P[2]], [sy * cp, sp, cy * cp]);
		const gpu = f[5]! < 0 ? undefined : idx(f[4]!, f[5]!, f[6]!);
		if (gpu != hit?.[0]) drift.hits++;
	};

	const frames = (n: number) => new Promise<void>(resolve => requestAnimationFrame(() => (n > 1 ? frames(n - 1).then(resolve) : setTimeout(resolve))));
	/** Clicks, waits until the shader has applied it and patches the CPU copy around the target. */
	const act = async (button: number) => {
		if (!hit) return;
		click = button < 2 ? -1 : selected;
		await frames(2);
		await patch([hit[0], hit[0] + LAYER, hit[1]]);
	};
	const bench = async (n = 100) => {
		data.fill(0, 4, 8);
		data[9] = 0;
		const start = performance.now();
		for (let i = 0; i < n; i++) draw();
		await device.queue.onSubmittedWorkDone();
		return (performance.now() - start) / n;
	};
	Object.assign(globalThis, {
		dbg: {
			A, P, V, act, bench, drift,
			get hit() {
				return hit;
			},
			select: (block = selected) => (selected = block),
			sync,
			time: (seconds: number) => (clock = seconds * 1e3 - performance.now()),
			v,
		} satisfies Dbg,
	});
}
requestAnimationFrame(frame);
