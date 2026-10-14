/** `bun run bot house [--at x,z] [--shot dir] [--frames] [--size WxH] [--headed] [--no-build]`: builds a blueprint in the dev page with the bot and prints the result. */
import { mkdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import type { Check, Status } from '../src/dev/bot.ts';
import { build } from './build.ts';
import { Page, problems } from './webview.ts';

/** Start of the site search on the real terrain, pinned so a terrain change moves the house instead of breaking the test. */
export const HOUSE_NEAR: [number, number] = [280, 280];

const root = `${import.meta.dir}/..`;

interface RunOptions {
	/** Writes `frames/NNNNN.webp` for every poll. */
	frames?: boolean;
	/** Folder of the progress shots and of `final.webp`. */
	shot?: string;
}

export type Result = Status & { check: Check; problems: string[] };

/** View of a 9x9x9 blueprint from the door side: the position and angles of the fly camera. */
export const overview = ([ox, oy, oz]: readonly [number, number, number]) => {
	const [x, y, z] = [ox + 4.5, oy + 7, oz - 10.5];
	const [dx, dy, dz] = [ox + 4.5 - x, oy + 3 - y, oz + 4.5 - z];
	return { pitch: Math.atan2(dy, Math.hypot(dx, dz)), x, y, yaw: Math.atan2(dx, dz), z };
};

const webp = (png: Uint8Array) => new Bun.Image(png).webp({ quality: 80 }).bytes();

/** Starts the bot and polls it every 500 ms, strictly one evaluate or screenshot at a time. */
export async function runBot(page: Page, name: string, near: [number, number], { frames, shot }: RunOptions = {}): Promise<Result> {
	const read = async <T>(code: string) => JSON.parse((await page.view.evaluate(`JSON.stringify(${code})`)) as string) as T;
	for (let i = 0; i < 600 && (await page.view.evaluate('typeof bot')) != 'object'; i++) await Bun.sleep(100);
	if (shot) await mkdir(`${shot}/frames`, { recursive: true });
	await page.view.evaluate(`bot.start(${JSON.stringify(name)}, ${JSON.stringify(near)})`);
	let [phase, marked, progress, polls] = ['', 0, 0, 0];
	for (let status = await read<Status>('bot.status()'); ; status = await read<Status>('bot.status()')) {
		const jobs = status.placed + status.broken;
		const milestone = status.phase != phase || jobs - marked >= 25;
		if (shot && (milestone || frames)) {
			const webpShot = await webp(await page.view.screenshot({ encoding: 'buffer' }));
			if (milestone) await Bun.write(`${shot}/${String(++progress).padStart(3, '0')}-${status.phase}.webp`, webpShot);
			if (frames) await Bun.write(`${shot}/frames/${String(++polls).padStart(5, '0')}.webp`, webpShot);
			if (milestone) marked = jobs;
		}
		phase = status.phase;
		if (status.done) break;
		await Bun.sleep(500);
	}
	const status = await read<Status>('bot.status()');
	const check = await read<Check>(`bot.check(${JSON.stringify(name)}, ${JSON.stringify(status.origin ?? [0, 0, 0])})`);
	if (shot && status.origin) {
		const { pitch, x, y, yaw, z } = overview(status.origin);
		await page.run(`bot.fly(${x}, ${y}, ${z}, ${yaw}, ${pitch})`);
		await Bun.sleep(500);
		const png = await page.view.screenshot({ encoding: 'buffer' });
		await Bun.write(`${shot}/final.webp`, await webp(png));
		await Bun.write(`${shot}/final.png`, png);
	}
	return { ...status, check, problems: problems({ console: page.logs, url: page.view.url }) };
}

/** One summary line, then the failures, the teleports and the cells that differ. */
export function summary(name: string, r: Result) {
	const lines = [
		`${name} at ${r.origin}: placed ${r.placed}, broken ${r.broken}, scaffold ${r.scaffold}, failures ${r.failures.length}, teleports ${r.teleports.length}, ${(r.ms / 60000).toFixed(1)} min, ${r.frames} frames, mean dt ${(r.ms / r.frames).toFixed(1)} ms, ${r.check.matching}/${r.check.expected} cells`,
	];
	if (r.error) lines.push(`error: ${r.error}`);
	for (const line of [...r.failures, ...r.teleports, ...r.check.missing.map(m => `missing ${m}`), ...r.problems]) lines.push(`  ${line}`);
	return lines.join('\n');
}

if (import.meta.main) {
	const { positionals, values } = parseArgs({
		allowPositionals: true,
		args: Bun.argv.slice(2),
		options: { at: { type: 'string' }, frames: { type: 'boolean' }, headed: { type: 'boolean' }, 'no-build': { type: 'boolean' }, shot: { type: 'string' }, size: { type: 'string', default: '1280x720' } },
	});
	const name = positionals[0] ?? 'house';
	const [width, height] = values.size.split('x').map(Number) as [number, number];
	const near = values.at ? (values.at.split(',').map(Number) as [number, number]) : HOUSE_NEAR;
	if (!values['no-build']) console.log(await build(true));
	await using page = await Page.open(`${root}/dist/dev.html`, { headed: values.headed, height, width });
	const result = await runBot(page, name, near, values);
	console.log(summary(name, result));
	process.exitCode = result.check.missing.length || result.error || result.problems.length ? 1 : 0;
}
