import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import type { ZopfliOptions } from '@gfx/zopfli';

interface Job {
	input: Uint8Array;
	options: ZopfliOptions;
	reject: (error: Error) => void;
	resolve: (out: Uint8Array) => void;
}

const idle: Worker[] = [];
const queue: Job[] = [];
let spawned = 0;

function dispatch() {
	while (queue.length) {
		const worker = idle.pop() ?? (spawned < availableParallelism() ? (spawned++, new Worker(new URL('./zopfli.worker.ts', import.meta.url))) : undefined);
		if (!worker) return;
		const { input, options, reject, resolve } = queue.shift()!;
		worker.ref();
		worker.removeAllListeners();
		worker.once('error', reject);
		worker.once('message', (out: Uint8Array) => (worker.unref(), idle.push(worker), resolve(out), dispatch()));
		worker.postMessage({ input, options });
	}
}

/** `@gfx/zopfli`'s async API blocks its thread (synchronous WASM), so jobs run in a pool of Workers, one per core. */
export const zopfli = (input: Uint8Array, options: ZopfliOptions) =>
	new Promise<Uint8Array>((resolve, reject) => {
		queue.push({ input, options, reject, resolve });
		dispatch();
	});
