/** The fixed minifier chain: Closure Compiler, then terser with options and a mangler alphabet tuned once by a grid search (`pack()` follows in the build). */
import { tmpdir } from 'node:os';
import { minify, type MinifyOptions } from 'terser';

/** Mangled names start with these letters in this order (most used first), then the digits, same arithmetic as terser's `base54`. */
const CHARS = 'edtamfcuvoknsqbxgjywhlHpKziMBCrUNAEFPGLW_QTDIRSXOYJVZ$0123456789';
const nthIdentifier = {
	get(num: number) {
		let name = '';
		let base = 54;
		num++;
		do {
			num--;
			name += CHARS[num % base];
			num = Math.floor(num / base);
			base = 64;
		} while (num > 0);
		return name;
	},
};

/** The best options of the search, everything else is a terser default. `c` is the canvas, a free variable that is never renamed. */
const TERSER: MinifyOptions = {
	compress: { booleans_as_integers: true, keep_fargs: true, passes: 3, pure_getters: true, sequences: false, side_effects: false, unsafe: true, unsafe_arrows: true, unsafe_math: true, unsafe_methods: true },
	ecma: 2022,
	format: { keep_numbers: true, wrap_func_args: false, wrap_iife: true },
	mangle: { nth_identifier: nthIdentifier, reserved: ['c'] },
	module: false,
	toplevel: true,
};

const CLOSURE_PLATFORMS: Record<string, string> = { darwin: 'macos', linux: `linux${process.arch === 'arm64' ? '-arm64' : ''}`, win32: 'windows' };
/** The native binary of `google-closure-compiler`, undefined when its optional platform package is not installed. */
const CLOSURE = (() => {
	try {
		return Bun.resolveSync(`google-closure-compiler-${CLOSURE_PLATFORMS[process.platform]}/compiler${process.platform === 'win32' ? '.exe' : ''}`, import.meta.dir);
	} catch {}
})();
const EXTERNS = `${import.meta.dir}/lib/closure-externs.js`;
let warned = false;

/** Closure Compiler at SIMPLE level, undefined (and one warning) when the binary is missing. `var c` is the canvas, an extern. */
export async function closure(js: string) {
	if (!CLOSURE) {
		if (!warned) console.warn('google-closure-compiler is not installed: the build skips the Closure stage and the page is about 60 B larger.');
		warned = true;
		return undefined;
	}
	const file = `${tmpdir()}/4k-closure-${crypto.randomUUID()}.js`;
	await Bun.write(file, js);
	try {
		const args = ['--js', file, '--externs', EXTERNS, '--compilation_level', 'SIMPLE', '--language_in', 'ECMASCRIPT_NEXT', '--language_out', 'ECMASCRIPT_NEXT', '--warning_level', 'QUIET', '--jscomp_off=undefinedVars'];
		const proc = Bun.spawn([CLOSURE, ...args], { stderr: 'pipe', stdout: 'pipe' });
		const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
		if (code) throw new Error(`closure compiler failed: ${err.slice(0, 400)}`);
		return out.trim();
	} finally {
		await Bun.file(file).delete();
	}
}

/** Terser alone with the tuned options. */
export const terser = async (js: string) => (await minify(js, TERSER)).code!;

/** The bundle inside its `(async()=>{...})()` wrapper through Closure, then terser (terser alone without the Closure binary). */
export const minifyJs = async (wrapped: string) => terser((await closure(wrapped)) ?? wrapped);
