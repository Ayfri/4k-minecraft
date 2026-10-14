/** tsc and tests together, then build, then the page check: one table, output of failed steps only. `--fuzz`, `--shot <path>`, `--out <dir>`. */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { build } from './build.ts';
import { verify } from './verify.ts';

interface Result {
	detail: string;
	ok: boolean;
	output: string;
}

const { values } = parseArgs({ args: Bun.argv.slice(2).filter(a => a != '--'), options: { fuzz: { type: 'boolean' }, out: { type: 'string' }, shot: { type: 'string' } } });
const out = resolve(values.out ?? `${import.meta.dir}/../dist`);

const timed = async (name: string, run: () => Promise<Result>) => {
	const start = performance.now();
	const result = await run().catch((error: unknown): Result => ({ detail: '', ok: false, output: error instanceof Error ? error.message : String(error) }));
	return { ...result, ms: performance.now() - start, name };
};

/** stdout and stderr together, `bun test` reports on stderr. */
async function command(cmd: string[]) {
	const proc = Bun.spawn({ cmd, env: { ...process.env, NO_COLOR: '1' }, stderr: 'pipe', stdout: 'pipe' });
	const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
	return { code, text: stdout + stderr };
}

const tsc = async (): Promise<Result> => {
	const { code, text } = await command([process.execPath, 'x', 'tsc']);
	return { detail: code ? 'type errors' : 'no errors', ok: !code, output: text };
};

const tests = (...args: string[]) => async (): Promise<Result> => {
	const { code, text } = await command([process.execPath, ...args]);
	const [pass, fail] = ['pass', 'fail'].map(word => text.match(new RegExp(`^\\s*(\\d+) ${word}`, 'm'))?.[1] ?? '?');
	return { detail: `${pass} pass, ${fail} fail`, ok: !code, output: text.split('\n').filter(l => !l.startsWith('(pass)')).join('\n') };
};

const page = async (): Promise<Result> => {
	const { bad, report } = await verify(`${out}/index.html`, values.shot ? ['--shot', values.shot] : []);
	return { detail: `${bad.length ? `${bad.length} console problems` : 'console clean'}, shot ${report.shot}`, ok: !bad.length, output: bad.join('\n') };
};

const start = performance.now();
const steps = await Promise.all([timed('tsc', tsc), timed('test', tests('test')), ...(values.fuzz ? [timed('fuzz', tests('run', 'test:fuzz'))] : [])]);
if (steps.every(s => s.ok)) steps.push(await timed('build', async () => ({ detail: await build(false, { out }), ok: true, output: '' })));
if (steps.every(s => s.ok)) steps.push(await timed('verify', page));

const ok = steps.every(s => s.ok);
const rows = [...steps, { detail: '', name: 'total', ms: performance.now() - start, ok }].map(s => [s.name, s.ok ? 'ok' : 'FAIL', `${(s.ms / 1000).toFixed(1)}s`, s.detail]);
const widths = [0, 1, 2].map(i => Math.max(...rows.map(r => r[i]!.length)));
console.log(rows.map(r => `${r.map((cell, i) => (i < 3 ? cell.padEnd(widths[i]!) : cell)).join('  ')}`.trimEnd()).join('\n'));
for (const s of steps.filter(s => !s.ok)) console.log(`\n--- ${s.name} ---\n${s.output.trim().split('\n').slice(0, 60).join('\n')}`);
process.exitCode = ok ? 0 : 1;
