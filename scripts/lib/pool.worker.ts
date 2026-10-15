import { parentPort } from 'node:worker_threads';
import { deflateAsync } from '@gfx/zopfli';
import { search } from './deflate.ts';
import type { Task } from './pool.ts';

parentPort!.on('message', async (task: Task) => parentPort!.postMessage(task.kind === 'zopfli' ? await deflateAsync(task.input, task.options) : search(task.input, task.avoid, task.rounds, { seed: task.seed })));
