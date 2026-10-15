import { parentPort } from 'node:worker_threads';
import { deflateAsync } from '@gfx/zopfli';
import { shrink } from '../shrink.ts';
import { search } from './deflate.ts';
import type { Task } from './pool.ts';

const answer = async (task: Task) =>
	task.kind === 'zopfli' ? await deflateAsync(task.input, task.options) : task.kind === 'shrink' ? new TextEncoder().encode(shrink(task.js, undefined, undefined, task.shader)) : search(task.input, task.avoid, task.rounds, { seed: task.seed });

parentPort!.on('message', async (task: Task) => parentPort!.postMessage(await answer(task)));
