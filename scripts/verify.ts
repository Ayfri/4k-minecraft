/** Builds, opens the page in headless Chrome, fails on console errors and forwards the rest to `webview.ts` (`--dev --eval --keys`). */
import { tmpdir } from 'node:os';
import { build } from './build.ts';
import { inspect } from './webview.ts';

const args = Bun.argv.slice(2).filter(a => a != '--');
const dev = args.includes('--dev');

console.log(await build(dev));
const report = await inspect([`${import.meta.dir}/../dist/${dev ? 'dev' : 'index'}.html`, '--wait', '2500', '--shot', `${tmpdir()}/claude-temp/4k/verify.png`, ...args.filter(a => a != '--dev')]);
console.log(JSON.stringify(report, null, 1));
const bad = report.console.filter(l => /^\[(exception|error)\]|WebGPU|WGSL/.test(l));
if (bad.length) {
	console.error(`console problems:\n${bad.join('\n')}`);
	process.exitCode = 1;
}
