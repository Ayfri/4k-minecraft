import shader from './shader.wgsl' with { type: 'text' };
import { BYTES } from './world.ts';

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

/** The voxels, one byte per cell, and the 32 bytes of player state: the shader owns both, DEV reads them back. */
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

let last = 0;
const frame = (now: number) => {
	c.width = innerWidth;
	c.height = innerHeight;
	data.set([...A, c.width, c.height, +!!keys.KeyW - +!!keys.KeyS, +!!keys.KeyD - +!!keys.KeyA, +!!keys.Space, click, (DEV ? now + clock : now) / 1e3, Math.min(now - last, 30) / 1e3]);
	click = 0;
	last = now;
	draw();
	requestAnimationFrame(frame);
};
requestAnimationFrame(frame);

if (DEV) {
	device.onuncapturederror = e => console.error(e.error.message);
	for (const m of (await module.getCompilationInfo()).messages) console.log(`wgsl ${m.type} ${m.lineNum}: ${m.message}`);
	console.log(`gen ${(performance.now() - t0).toFixed(1)} ms`);
	const probe = device.createBuffer({ size: 64, usage: 9 });
	const peek = async () => {
		const encoder = device.createCommandEncoder();
		encoder.copyBufferToBuffer(state, 0, probe, 0, 32);
		device.queue.submit([encoder.finish()]);
		await probe.mapAsync(1);
		const f = [...new Float32Array(probe.getMappedRange().slice(0, 32))];
		probe.unmap();
		return f;
	};
	const at = async (x: number, y: number, z: number) => {
		const i = (x & 1023) | ((z & 1023) << 10) | (y << 20);
		const encoder = device.createCommandEncoder();
		encoder.copyBufferToBuffer(world, i & ~3, probe, 0, 4);
		device.queue.submit([encoder.finish()]);
		await probe.mapAsync(1);
		const b = new Uint8Array(probe.getMappedRange().slice(0, 4))[i & 3];
		probe.unmap();
		return b;
	};
	const act = (button: number) => (click = button < 2 ? -1 : selected);
	Object.assign(globalThis, { dbg: { A, act, at, peek, select: (block = selected) => (selected = block) } });
}
