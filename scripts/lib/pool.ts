import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import type { ZopfliOptions } from '@gfx/zopfli';

/** What a worker runs: zopfli, or the `search` of `deflate.ts` (`seed` picks one of its deterministic runs). */
export type Task = { input: Uint8Array; kind: 'zopfli'; options: ZopfliOptions } | { avoid: number[]; input: Uint8Array; kind: 'search'; seed: number };

interface Job {
	reject: (error: Error) => void;
	resolve: (out: Uint8Array | undefined) => void;
	task: Task;
}

const idle: Worker[] = [];
const queue: Job[] = [];
let spawned = 0;

function dispatch() {
	while (queue.length) {
		const worker = idle.pop() ?? (spawned < availableParallelism() ? (spawned++, new Worker(new URL('./pool.worker.ts', import.meta.url))) : undefined);
		if (!worker) return;
		const { reject, resolve, task } = queue.shift()!;
		worker.ref();
		worker.removeAllListeners();
		worker.once('error', reject);
		worker.once('message', (out: Uint8Array | undefined) => (worker.unref(), idle.push(worker), resolve(out), dispatch()));
		worker.postMessage(task);
	}
}

/** Both tasks block their thread (synchronous WASM, a long search), so jobs run in a pool of Workers, one per core. */
const run = (task: Task) =>
	new Promise<Uint8Array | undefined>((resolve, reject) => {
		queue.push({ reject, resolve, task });
		dispatch();
	});

export const zopfli = async (input: Uint8Array, options: ZopfliOptions) => (await run({ input, kind: 'zopfli', options }))!;

export const search = (input: Uint8Array, avoid: number[], seed: number) => run({ avoid, input, kind: 'search', seed });
