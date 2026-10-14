import { parentPort } from 'node:worker_threads';
import { deflateAsync, type ZopfliOptions } from '@gfx/zopfli';

parentPort!.on('message', async ({ input, options }: { input: Uint8Array; options: ZopfliOptions }) => parentPort!.postMessage(await deflateAsync(input, options)));
