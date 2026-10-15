import shader from './shader.wgsl' with { type: 'text' };
import { BYTES } from './world.ts';

/** Yaw and pitch, the shader derives the view direction and the walk direction from them. */
const A: [number, number] = [-1.7, -.02];
/** Milliseconds added to the page clock, set by `dbg.time`. */
let clock = 0;
let keys: Record<string, boolean> = {};
const key = (code: string) => +!!keys[code];

c.style = 'position:fixed;inset:0';
c.width = innerWidth;
c.height = innerHeight;

const device = await (await navigator.gpu.requestAdapter())!.requestDevice();
const { queue } = device;
const ctx = c.getContext('webgpu')!;
/** Usage 8 is STORAGE_BINDING: the compute shader writes each frame straight into the canvas texture (`bgra8unorm` would need a device feature). */
ctx.configure({ device, format: 'rgba8unorm', usage: 8 });
const module = device.createShaderModule({ code: shader });

/** The voxels, one byte per cell, and the 32 bytes of player state: the shader owns both. */
const world = device.createBuffer({ size: BYTES, usage: 132 });
const state = device.createBuffer({ size: 48, usage: 132 });
const pipeline = device.createComputePipeline({ compute: { module }, layout: 'auto' });

/** The `Uniforms` immediates: view angles, canvas size (0 while the world generates), forward, right, jump, click, time, frame time. */
const data = new Float32Array(10);

/** Encodes one pass: `g` over `x` by `y` workgroups (the world gen or the render), then the player step in a lone workgroup that the next frame renders. */
const run = (x: number, y = 1) => {
	const encoder = device.createCommandEncoder();
	const pass = encoder.beginComputePass();
	pass.setPipeline(pipeline);
	pass.setBindGroup(0, device.createBindGroup({ entries: [{ binding: 0, resource: world }, { binding: 1, resource: ctx.getCurrentTexture() }, { binding: 2, resource: state }], layout: pipeline.getBindGroupLayout(0) }));
	pass.setImmediates(0, data);
	pass.dispatchWorkgroups(x, y);
	pass.dispatchWorkgroups(1);
	pass.end();
	queue.submit([encoder.finish()]);
};

const t0 = DEV ? performance.now() : 0;
run(4096);

const draw = () => run(c.width / 64 + 1, c.height);

/** Block placed by the right button, picked with the digit keys (ids 4 to 13, `Digit1` is grass and `Digit0` the tenth, glass). */
let selected = 4;
/** The click of the next frame for the shader: -1 breaks the target and the plant above it, the selected block is placed in the free cell or over a plant. */
let click = 0;
onkeydown = onkeyup = e => ((keys[e.code] = e.type < 'keyu'), (selected = ((+e.code[5]! + 9) % 10) + 4 || selected));
onmousedown = e => (document.pointerLockElement ? (click = e.button < 2 ? -1 : selected) : c.requestPointerLock({ unadjustedMovement: true }).catch(() => c.requestPointerLock()));
oncontextmenu = () => !1;
onblur = () => (keys = {});
onresize = () => ((c.width = innerWidth), (c.height = innerHeight));
onmousemove = e => {
	if (!document.pointerLockElement) return;
	A[0] += e.movementX * .002;
	A[1] = Math.max(-1.55, Math.min(1.55, A[1] - e.movementY * .002));
};

const frame = (now: number) => {
	data.set([...A, c.width, c.height, key('KeyW') - key('KeyS'), key('KeyD') - key('KeyA'), key('Space'), click, (DEV ? now + clock : now) / 1e3]);
	click = 0;
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
		queue.submit([encoder.finish()]);
		await probe.mapAsync(1);
		const f = [...new Float32Array(probe.getMappedRange().slice(0))];
		probe.unmap();
		return f;
	};
	Object.assign(globalThis, { dbg: { A, peek } });
}
