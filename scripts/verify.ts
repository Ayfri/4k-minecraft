/**
 * Builds, opens the page in headless Chrome and fails on console errors. Extra arguments go to `scripts/browser.ts`:
 * `bun run verify -- --dev --eval "dbg.bench()" --shot out.png`. Without `--shot` the screenshot lands in the temp folder.
 */
import { tmpdir } from 'node:os';

const args = Bun.argv.slice(2).filter(a => a != '--');
const dev = args.includes('--dev');
const run = (cmd: string[], stdout: 'inherit' | 'pipe') => Bun.spawn(cmd, { stderr: 'inherit', stdout });

const build = run(['bun', `${import.meta.dir}/build.ts`, ...(dev ? ['--dev'] : [])], 'inherit');
if ((await build.exited) != 0) process.exit(1);

const browserArgs = args.filter(a => a != '--dev');
const browser = run(
	['bun', `${import.meta.dir}/browser.ts`, `${import.meta.dir}/../dist/${dev ? 'dev' : 'index'}.html`, '--wait', '4000', '--shot', `${tmpdir()}/claude-temp/4k/verify.png`, ...browserArgs],
	'pipe',
);
const output = await new Response(browser.stdout).text();
if ((await browser.exited) != 0) process.exit(1);
console.log(output);
const { console: lines } = JSON.parse(output) as { console: string[] };
const bad = lines.filter(l => /^\[(exception|error)\]|WebGPU|WGSL/.test(l));
if (bad.length) {
	console.error(`console problems:\n${bad.join('\n')}`);
	process.exit(1);
}
