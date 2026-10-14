/** Page driver on `Bun.WebView`, one Chrome and profile per `Page`. CLI: `bun scripts/webview.ts <file> --wait ms --shot f.png --eval expr --keys "w:500" --size 1280x720 --headed`. */
import { existsSync, rmSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

interface Remote {
	description?: string;
	value?: unknown;
}

interface PageOptions {
	headed?: boolean;
	height?: number;
	width?: number;
}

const PROFILES = `${tmpdir()}/claude-temp/4k`;

/** Chromes still running with their profile directory, ended by the exit and signal handlers when a hang or Ctrl+C skips `asyncDispose`. */
const live = new Map<Bun.Subprocess, string>();

/** `kill()` only ends the browser process, its children keep files of the profile locked for a while on Windows. */
const killTree = (chrome: Bun.Subprocess) =>
	process.platform === 'win32' ? Bun.spawnSync(['taskkill', '/F', '/T', '/PID', String(chrome.pid)], { stderr: 'ignore', stdout: 'ignore' }) : chrome.kill();

process.once('exit', () => {
	for (const [chrome, profile] of live) {
		killTree(chrome);
		Bun.sleepSync(500);
		try {
			rmSync(profile, { force: true, maxRetries: 20, recursive: true, retryDelay: 100 });
		} catch {}
	}
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => process.exit(130));

const release = async (chrome: Bun.Subprocess, profile: string, view?: Bun.WebView) => {
	view?.close();
	killTree(chrome);
	await chrome.exited;
	live.delete(chrome);
	await rm(profile, { force: true, maxRetries: 20, recursive: true, retryDelay: 100 }).catch(e => console.error(`could not remove ${profile}: ${e}`));
};

export class Page implements AsyncDisposable {
	private constructor(
		/** Console lines as `[type] text`, uncaught exceptions as `[exception]`, browser log entries as `[level]`. */
		readonly logs: string[],
		readonly view: Bun.WebView,
		private readonly chrome: Bun.Subprocess,
		private readonly profile: string,
	) {}

	/** Opens a file path or URL. */
	static async open(target: string, { headed = false, height = 720, width = 1280 }: PageOptions = {}) {
		const path = Bun.which('chrome') ?? Bun.which('google-chrome') ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
		if (!path) throw new Error('Chrome not found');
		await mkdir(PROFILES, { recursive: true });
		const profile = await mkdtemp(`${PROFILES}/chrome-`);
		/** The backend's own Chrome gets `--disable-gpu` (no WebGPU adapter), so it is launched here and the backend only drives it. */
		let chrome: Bun.Subprocess;
		try {
			chrome = Bun.spawn(
				[
					path,
					'--remote-debugging-port=0',
					`--user-data-dir=${profile}`,
					'--disable-backgrounding-occluded-windows',
					'--disable-renderer-backgrounding',
					'--enable-unsafe-webgpu',
					'--no-default-browser-check',
					'--no-first-run',
					...(headed ? [] : ['--headless=new']),
					'about:blank',
				],
				{ stderr: 'ignore', stdout: 'ignore' },
			);
		} catch (error) {
			await rm(profile, { force: true, recursive: true });
			throw error;
		}
		live.set(chrome, profile);
		let opened: Bun.WebView | undefined;
		try {
			let ws = '';
			for (let i = 0; i < 200 && !ws; i++) {
				await Bun.sleep(50);
				const [port, endpoint] = (await Bun.file(`${profile}/DevToolsActivePort`).text().catch(() => '')).split('\n');
				if (endpoint) ws = `ws://127.0.0.1:${port}${endpoint}`;
			}
			if (!ws) throw new Error('no DevTools endpoint');
			const logs: string[] = [];
			/** The backend consumes `Runtime.consoleAPICalled` for the `console` option, a listener on that event never fires. */
			const view = (opened = new Bun.WebView({
				backend: { type: 'chrome', url: ws },
				console: (type, ...args) => logs.push(`[${type}] ${args.map(a => (typeof a === 'object' && a ? (a as Remote).description : a)).join(' ')}`),
				height,
				width,
			}));
			const on = <T>(event: `${string}.${string}`, listener: (data: T) => void) => view.addEventListener(event, e => listener((e as MessageEvent<T>).data));
			await view.navigate('about:blank');
			/** Only one `cdp()` and one `evaluate()` may be in flight per view. */
			await view.cdp('Runtime.enable');
			await view.cdp('Log.enable');
			/** The headless window loses its frame to the viewport (1264x625 for a 1280x720 request), the override pins the exact size. */
			await view.cdp('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, height, mobile: false, width });
			on<{ exceptionDetails: { exception?: Remote } }>('Runtime.exceptionThrown', p => logs.push(`[exception] ${JSON.stringify(p.exceptionDetails.exception?.description ?? p.exceptionDetails)}`));
			on<{ entry: { level: string; text: string } }>('Log.entryAdded', p => logs.push(`[${p.entry.level}] ${p.entry.text}`));
			await view.navigate(/^[a-z]{2,}:/.test(target) ? target : pathToFileURL(target).href);
			return new Page(logs, view, chrome, profile);
		} catch (error) {
			await release(chrome, profile, opened);
			throw error;
		}
	}

	/** `"w:500,space:100"` holds each key for the given milliseconds (100 by default), in order. A digit is the `Digit` key. */
	async keys(spec: string) {
		for (const step of spec.split(',')) {
			const [name = '', ms = '100'] = step.split(':');
			const key = name === 'space' ? ' ' : name;
			const code = name === 'space' ? 'Space' : name === 'shift' ? 'ShiftLeft' : /\d/.test(name) ? `Digit${name}` : `Key${name.toUpperCase()}`;
			await this.view.cdp('Input.dispatchKeyEvent', { code, key, text: key.length === 1 ? key : '', type: 'keyDown' });
			await Bun.sleep(Number(ms));
			await this.view.cdp('Input.dispatchKeyEvent', { code, key, type: 'keyUp' });
		}
	}

	[Symbol.asyncDispose]() {
		return release(this.chrome, this.profile, this.view);
	}
}

interface Report {
	console: string[];
	eval?: unknown;
	shot?: string;
	url: string;
}

/** Runs the CLI arguments: open, wait, keys, eval, screenshot. */
export async function inspect(argv: string[]): Promise<Report> {
	const { positionals, values } = parseArgs({
		allowPositionals: true,
		args: argv,
		options: { eval: { type: 'string' }, headed: { type: 'boolean', default: false }, keys: { type: 'string' }, shot: { type: 'string' }, size: { type: 'string', default: '1280x720' }, wait: { type: 'string', default: '2000' } },
	});
	const target = positionals[0];
	if (!target) throw new Error('usage: bun scripts/webview.ts <file-or-url> [--wait ms] [--eval expr] [--shot file.png] [--keys "w:500,space:100"] [--size 1280x720] [--headed]');
	const [width, height] = values.size.split('x').map(Number) as [number, number];
	await using page = await Page.open(target, { headed: values.headed, height, width });
	await Bun.sleep(Number(values.wait));
	if (values.keys) await page.keys(values.keys);
	const report: Report = { console: page.logs, url: page.view.url };
	if (values.eval) report.eval = await page.view.evaluate(values.eval);
	if (values.shot) {
		await Bun.write(values.shot, await page.view.screenshot({ encoding: 'buffer' }));
		report.shot = values.shot;
	}
	return report;
}

if (import.meta.main) console.log(JSON.stringify(await inspect(Bun.argv.slice(2)), null, 1));
