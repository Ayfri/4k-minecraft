import shader from './shader.wgsl' with { type: 'text' };
import { collides, lift, move, target, WATER, type Vec3 } from './world.ts';

/** Feet position, spawned above the grass east of the lake and dropped onto the terrain. */
const P: Vec3 = [280.5, 64, 280.5];
const v: Vec3 = [0, 0, 0];
const A: [number, number] = [-2.4, -.25];
/** Milliseconds added to the page clock, set by `dbg.time`. */
let clock = 0;
let keys: Record<string, boolean> = {};
const key = (code: string) => +!!keys[code];

c.style = 'position:fixed;inset:0;width:100%;height:100%;image-rendering:pixelated';
c.width = innerWidth / 2;
c.height = innerHeight / 2;

const device = await (await navigator.gpu.requestAdapter())!.requestDevice();
const { queue } = device;
const ctx = c.getContext('webgpu')!;
ctx.configure({ device, format: 'bgra8unorm' });
const module = device.createShaderModule({ code: shader });

const world = device.createBuffer({ size: 1 << 24, usage: 140 });
const uniforms = device.createBuffer({ size: 48, usage: 72 });
const readback = device.createBuffer({ size: 1 << 24, usage: 9 });
const entries = [
	{ binding: 0, resource: world },
	{ binding: 1, resource: uniforms },
];
const bind = (pipeline: GPUComputePipeline | GPURenderPipeline) => device.createBindGroup({ entries, layout: pipeline.getBindGroupLayout(0) });
const compute = device.createComputePipeline({ compute: { module }, layout: 'auto' });
const render = device.createRenderPipeline({ fragment: { module, targets: [{ format: 'bgra8unorm' }] }, layout: 'auto', vertex: { module } });
const renderBinds = bind(render);

/** The targeted voxel index and the free cell in front of it, refreshed every frame. */
let hit: [number, number] | undefined;

/** Writes the `Uniforms` floats: eye, time, view direction, targeted voxel index (-1 for none), canvas size. */
const upload = (seconds: number, eye: Vec3, dir: Vec3) => queue.writeBuffer(uniforms, 0, new Float32Array([...eye, seconds, ...dir, hit?.[0] ?? -1, c.width, c.height]));

const t0 = DEV ? performance.now() : 0;
const gen = device.createCommandEncoder();
const genPass = gen.beginComputePass();
genPass.setPipeline(compute);
genPass.setBindGroup(0, bind(compute));
genPass.dispatchWorkgroups(1024);
genPass.end();
gen.copyBufferToBuffer(world, readback, 1 << 24);
queue.submit([gen.finish()]);
await readback.mapAsync(1);
const V = new Uint8Array(readback.getMappedRange());

const draw = () => {
	const encoder = device.createCommandEncoder();
	const pass = encoder.beginRenderPass({ colorAttachments: [{ loadOp: 'clear', storeOp: 'store', view: ctx.getCurrentTexture() }] });
	pass.setPipeline(render);
	pass.setBindGroup(0, renderBinds);
	pass.draw(3);
	pass.end();
	queue.submit([encoder.finish()]);
};

/** Sets a voxel and uploads the 4-byte word that holds it. */
const put = (i: number, b: number) => {
	V[i] = b;
	queue.writeBuffer(world, i & ~3, V, i & ~3, 4);
};

/** Left click breaks the target and the plant above it, right click places the selected block in a free cell or over a plant. */
const act = (button: number) => {
	if (!hit) return;
	const [i, free] = hit;
	if (button < 2) return put(i, 0), V[i + 262144]! < WATER && put(i + 262144, 0);
	const cell = V[i]! < WATER ? i : free;
	const old = V[cell]!;
	if (old <= WATER) {
		put(cell, selected);
		if (collides(V, P)) put(cell, old);
	}
};

/** Block placed by the right button, picked with the digit keys 1 to 9 (ids 4 to 12, `Digit1` is grass). */
let selected = 4;
onkeydown = onkeyup = e => ((keys[e.code] = e.type < 'keyu'), (selected = (+e.code[5]! || selected - 3) + 3));
onmousedown = e => (document.pointerLockElement ? act(e.button) : c.requestPointerLock({ unadjustedMovement: true }).catch(() => c.requestPointerLock()));
oncontextmenu = () => !1;
onblur = () => (keys = {});
onmousemove = e => {
	if (!document.pointerLockElement) return;
	A[0] += e.movementX * .002;
	A[1] = Math.max(-1.55, Math.min(1.55, A[1] - e.movementY * .002));
};

let last = 0;
let ground = false;
const frame = (now: number) => {
	const dt = Math.min(now - last, 30) / 1e3;
	last = now;
	const [sy, sp] = A.map(Math.sin) as typeof A;
	const [cy, cp] = A.map(Math.cos) as typeof A;
	const [fw, rt] = [key('KeyW') - key('KeyS'), key('KeyD') - key('KeyA')];
	v[0] = (fw * sy + rt * cy) * 4.3;
	v[2] = (fw * cy - rt * sy) * 4.3;
	v[1] = lift(V, P, v[1], dt, key('Space'), ground);
	ground = move(V, P, v, dt);
	const eye: Vec3 = [P[0], P[1] + 1.62, P[2]];
	const dir: Vec3 = [sy * cp, sp, cy * cp];
	hit = target(V, eye, dir);
	upload((DEV ? now + clock : now) / 1e3, eye, dir);
	draw();
	requestAnimationFrame(frame);
};
requestAnimationFrame(frame);

if (DEV) {
	device.onuncapturederror = e => console.error(e.error.message);
	for (const m of (await module.getCompilationInfo()).messages) console.log(`wgsl ${m.type} ${m.lineNum}: ${m.message}`);
	console.log(`gen ${(performance.now() - t0).toFixed(1)} ms`);
	const bench = async (n = 100) => {
		const start = performance.now();
		for (let i = 0; i < n; i++) draw();
		await queue.onSubmittedWorkDone();
		return (performance.now() - start) / n;
	};
	const time = (seconds: number) => (clock = seconds * 1e3 - performance.now());
	const select = (block = selected) => (selected = block);
	Object.assign(globalThis, { dbg: { A, P, V, act, bench, select, time, v } });
}
