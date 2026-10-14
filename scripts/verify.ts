/** Builds (`--dev`, `--out <dir>`), opens the page in headless Chrome, fails on console problems, forwards the rest to `webview.ts`. */
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { build } from './build.ts';
import { inspect, problems, summarize } from './webview.ts';

/** Opens `file` for 2.5 s, screenshots it to `claude-temp/4k/verify.png` and lists the console problems, `extra` goes to `inspect()`. */
export async function verify(file: string, extra: string[] = []) {
	const report = await inspect([file, '--wait', '2500', '--shot', `${tmpdir()}/claude-temp/4k/verify.png`, ...extra]);
	return { bad: problems(report), report };
}

if (import.meta.main) {
	const args = Bun.argv.slice(2).filter(a => a != '--');
	const dev = args.includes('--dev');
	const at = args.indexOf('--out');
	const out = resolve(at < 0 ? `${import.meta.dir}/../dist` : args[at + 1]!);
	const verbose = args.includes('--verbose');
	const line = await build(dev, { out, verbose });
	const rest = args.filter((a, i) => a != '--dev' && a != '--out' && (at < 0 || i != at + 1));
	const { bad, report } = await verify(`${out}/${dev ? 'dev' : 'index'}.html`, rest);
	console.log(`${bad.length ? 'FAIL' : 'ok'} ${line}\n${summarize(report, verbose)}`);
	if (bad.length) process.exitCode = 1;
}
