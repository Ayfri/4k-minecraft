import shader from './shader.wgsl' with { type: 'text' };

const P: [number, number, number] = [256.5, 70, 256.5];
const A: [number, number] = [0, -.6];
const keys: Record<string, boolean> = {};
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

/** Writes the 12 floats of the `Uniforms` struct: eye, time, canvas size, yaw and pitch, targeted cell, seed. */
const upload = (seconds: number) => queue.writeBuffer(uniforms, 0, new Float32Array([...P, seconds, c.width, c.height, ...A, -1, -1, -1, 1]));

const t0 = DEV ? performance.now() : 0;
upload(0);
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
	return encoder.finish();
};

onkeydown = onkeyup = e => (keys[e.code] = e.type == 'keydown');
c.onclick = () => c.requestPointerLock({ unadjustedMovement: true });
onmousemove = e => {
	if (!document.pointerLockElement) return;
	A[0] += e.movementX * .002;
	A[1] = Math.max(-1.55, Math.min(1.55, A[1] - e.movementY * .002));
};

let last = 0;
const frame = (now: number) => {
	const step = Math.min(now - last, 50) * .01;
	last = now;
	const [sy, sp, cy, cp] = [Math.sin(A[0]), Math.sin(A[1]), Math.cos(A[0]), Math.cos(A[1])];
	const [fw, rt, up] = [key('KeyW') - key('KeyS'), key('KeyD') - key('KeyA'), key('Space') - key('ShiftLeft')];
	P[0] += (fw * sy * cp + rt * cy) * step;
	P[1] += (fw * sp + up) * step;
	P[2] += (fw * cy * cp - rt * sy) * step;
	for (const a of [0, 2] as const) P[a] -= Math.floor(P[a] / 512) * 512;
	upload(now / 1e3);
	queue.submit([draw()]);
	requestAnimationFrame(frame);
};
requestAnimationFrame(frame);

if (DEV) {
	device.onuncapturederror = e => console.error(e.error.message);
	for (const m of (await module.getCompilationInfo()).messages) console.log(`wgsl ${m.type} ${m.lineNum}: ${m.message}`);
	console.log(`gen ${(performance.now() - t0).toFixed(1)} ms`);
	const bench = async (n = 100) => {
		const start = performance.now();
		for (let i = 0; i < n; i++) queue.submit([draw()]);
		await queue.onSubmittedWorkDone();
		return (performance.now() - start) / n;
	};
	Object.assign(globalThis, { dbg: { A, P, V, bench } });
}
