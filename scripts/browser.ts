/**
 * Opens a page in a throwaway Chrome over the DevTools protocol, then prints console output, an optional evaluated
 * expression and an optional screenshot. Example: `bun scripts/browser.ts dist/index.html --wait 3000 --shot out.png`
 */
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

const { positionals, values } = parseArgs({
	allowPositionals: true,
	options: {
		eval: { type: 'string' },
		headed: { type: 'boolean', default: false },
		keys: { type: 'string' },
		shot: { type: 'string' },
		size: { type: 'string', default: '1280x720' },
		wait: { type: 'string', default: '2000' },
	},
});

const target = positionals[0];
if (!target) throw new Error('usage: bun scripts/browser.ts <file-or-url> [--wait ms] [--eval expr] [--shot file.png] [--keys "w:500,space:100"] [--headed]');
const url = /^[a-z]+:/.test(target) && !/^[a-zA-Z]:\\/.test(target) ? target : pathToFileURL(target).href;
const [width, height] = values.size.split('x').map(Number);
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
if (!chrome) throw new Error('Chrome not found');

const port = 9400 + Math.floor(Math.random() * 500);
const proc = Bun.spawn(
	[
		chrome,
		`--remote-debugging-port=${port}`,
		`--user-data-dir=${tmpdir()}/claude-temp/4k-chrome-${port}`,
		`--window-size=${width},${height}`,
		'--disable-backgrounding-occluded-windows',
		'--disable-renderer-backgrounding',
		'--enable-unsafe-webgpu',
		'--no-default-browser-check',
		'--no-first-run',
		...(values.headed ? [] : ['--headless=new']),
		'about:blank',
	],
	{ stderr: 'ignore', stdout: 'ignore' },
);

interface Target {
	type: string;
	webSocketDebuggerUrl: string;
}
interface CdpMessage {
	error?: { message: string };
	id?: number;
	method?: string;
	params?: Record<string, unknown>;
	result?: Record<string, unknown>;
}

let page: Target | undefined;
for (let i = 0; i < 100 && !page; i++) {
	await Bun.sleep(100);
	page = await fetch(`http://127.0.0.1:${port}/json/list`)
		.then(r => r.json() as Promise<Target[]>)
		.then(list => list.find(t => t.type === 'page'))
		.catch(() => undefined);
}
if (!page) throw new Error('no DevTools page target');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
const pending = new Map<number, (m: CdpMessage) => void>();
const logs: string[] = [];
let loaded = () => {};
ws.addEventListener('message', event => {
	const message = JSON.parse(String(event.data)) as CdpMessage;
	if (message.id) pending.get(message.id)?.(message);
	const p = message.params ?? {};
	if (message.method === 'Runtime.consoleAPICalled') logs.push(`[${p.type}] ${(p.args as { value?: unknown; description?: string }[]).map(a => a.value ?? a.description).join(' ')}`);
	if (message.method === 'Runtime.exceptionThrown') logs.push(`[exception] ${JSON.stringify((p.exceptionDetails as { exception?: { description?: string } }).exception?.description ?? p.exceptionDetails)}`);
	if (message.method === 'Log.entryAdded') logs.push(`[${(p.entry as { level: string }).level}] ${(p.entry as { text: string }).text}`);
	if (message.method === 'Page.loadEventFired') loaded();
});
let nextId = 0;
const send = (method: string, params: Record<string, unknown> = {}) =>
	new Promise<CdpMessage>(resolve => {
		const id = ++nextId;
		pending.set(id, resolve);
		ws.send(JSON.stringify({ id, method, params }));
	});

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, height, mobile: false, width });
const load = new Promise<void>(resolve => (loaded = resolve));
await send('Page.navigate', { url });
await Promise.race([load, Bun.sleep(10000)]);
await Bun.sleep(Number(values.wait));

/** `--keys "w:500,space:100"` holds each key for the given milliseconds, in order. */
for (const step of values.keys ? values.keys.split(',') : []) {
	const [key = '', ms = '100'] = step.split(':');
	const code = key === 'space' ? 'Space' : key === 'shift' ? 'ShiftLeft' : /\d/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`;
	const text = key === 'space' ? ' ' : key.length === 1 ? key : '';
	await send('Input.dispatchKeyEvent', { code, key: key === 'space' ? ' ' : key, text, type: 'keyDown' });
	await Bun.sleep(Number(ms));
	await send('Input.dispatchKeyEvent', { code, key: key === 'space' ? ' ' : key, type: 'keyUp' });
}

const report: Record<string, unknown> = { url };
if (values.eval) {
	const result = await send('Runtime.evaluate', { awaitPromise: true, expression: values.eval, returnByValue: true });
	report.eval = (result.result?.result as { value?: unknown } | undefined)?.value ?? result.result;
}
if (values.shot) {
	const shot = await send('Page.captureScreenshot', { format: 'png' });
	await Bun.write(values.shot, Buffer.from(String(shot.result?.data), 'base64'));
	report.shot = values.shot;
}
report.console = logs;
console.log(JSON.stringify(report, null, 1));
ws.close();
proc.kill();
await proc.exited;
