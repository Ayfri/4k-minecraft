/**
 * Opens a page in `Bun.WebView` (Chrome backend), then prints console output, an optional evaluated expression and an
 * optional screenshot as JSON. Same CLI as `scripts/browser.ts`: `bun scripts/webview.ts dist/index.html --wait 3000 --shot out.png`
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
if (!target) throw new Error('usage: bun scripts/webview.ts <file-or-url> [--wait ms] [--eval expr] [--shot file.png] [--keys "w:500,space:100"] [--headed]');
const url = /^[a-z]{2,}:/.test(target) ? target : pathToFileURL(target).href;
const [width, height] = values.size.split('x').map(Number) as [number, number];
const path = Bun.which('chrome') ?? Bun.which('google-chrome') ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
if (!path) throw new Error('Chrome not found');

/**
 * A Chrome spawned by the backend always gets `--disable-gpu` (no WebGPU adapter, whatever `argv` adds), so the script launches
 * Chrome itself and hands its DevTools WebSocket to the backend, `Bun.WebView` only drives it.
 */
const port = 9400 + Math.floor(Math.random() * 500);
const chrome = Bun.spawn(
	[
		path,
		`--remote-debugging-port=${port}`,
		`--user-data-dir=${tmpdir()}/claude-temp/4k-webview-${port}`,
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
let ws = '';
for (let i = 0; i < 100 && !ws; i++) {
	await Bun.sleep(100);
	ws = await fetch(`http://127.0.0.1:${port}/json/version`)
		.then(async r => ((await r.json()) as { webSocketDebuggerUrl: string }).webSocketDebuggerUrl)
		.catch(() => '');
}
if (!ws) throw new Error('no DevTools endpoint');
const view = new Bun.WebView({ backend: { type: 'chrome', url: ws }, height, width });

interface Remote {
	description?: string;
	value?: unknown;
}
const logs: string[] = [];
const on = <T>(event: `${string}.${string}`, listener: (data: T) => void) => view.addEventListener(event, e => listener((e as MessageEvent<T>).data));
await view.navigate('about:blank');
/** Only one `cdp()` and one `evaluate()` may be in flight per view. */
await view.cdp('Runtime.enable');
await view.cdp('Log.enable');
on<{ args: Remote[]; type: string }>('Runtime.consoleAPICalled', p => logs.push(`[${p.type}] ${p.args.map(a => a.value ?? a.description).join(' ')}`));
on<{ exceptionDetails: { exception?: Remote } }>('Runtime.exceptionThrown', p => logs.push(`[exception] ${JSON.stringify(p.exceptionDetails.exception?.description ?? p.exceptionDetails)}`));
on<{ entry: { level: string; text: string } }>('Log.entryAdded', p => logs.push(`[${p.entry.level}] ${p.entry.text}`));
await view.navigate(url);
await Bun.sleep(Number(values.wait));

/** `--keys "w:500,space:100"` holds each key for the given milliseconds, in order. */
for (const step of values.keys ? values.keys.split(',') : []) {
	const [key = '', ms = '100'] = step.split(':');
	const code = key === 'space' ? 'Space' : key === 'shift' ? 'ShiftLeft' : /\d/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`;
	const text = key === 'space' ? ' ' : key.length === 1 ? key : '';
	await view.cdp('Input.dispatchKeyEvent', { code, key: key === 'space' ? ' ' : key, text, type: 'keyDown' });
	await Bun.sleep(Number(ms));
	await view.cdp('Input.dispatchKeyEvent', { code, key: key === 'space' ? ' ' : key, type: 'keyUp' });
}

const report: Record<string, unknown> = { url };
if (values.eval) report.eval = await view.evaluate(values.eval);
if (values.shot) {
	await Bun.write(values.shot, await view.screenshot({ encoding: 'buffer' }));
	report.shot = values.shot;
}
report.console = logs;
console.log(JSON.stringify(report, null, 1));
Bun.WebView.closeAll();
chrome.kill();
await chrome.exited;
