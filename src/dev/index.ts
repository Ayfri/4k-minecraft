import { Bot } from './bot.ts';

/** `main.ts` awaits the GPU before it publishes `dbg`, a module script that comes after it does not wait for that. */
while (!('dbg' in globalThis)) await new Promise(resolve => setTimeout(resolve, 50));

/** The timeout lands after every animation frame callback of the batch, so the game's frame has refreshed `hit` for the new view. */
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve)));
const key = (code: string, down: boolean) => void dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));

Object.assign(globalThis, { bot: new Bot(dbg, { frame, key }) });
