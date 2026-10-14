import { expect, test } from 'bun:test';
import * as world from '../src/world.ts';
import { minifyWgsl, renameWgsl, substituteConstants } from './wgsl.ts';

const MINIFY: [string, string, string][] = [
	['spaces around a comparison', 'a  <  b', 'a<b'],
	['shift', 'x = a << 2u;', 'x=a<<2u;'],
	['logic and comparison chain', 'x = a >= b && c != d || !e;', 'x=a>=b&&c!=d||!e;'],
	['unary minus after binary minus', 'x = -a - -b;', 'x=-a- -b;'],
	['comment between two minus signs', 'a -/*c*/- b', 'a- -b'],
	['compound assignment with a negative', 'a += -1;', 'a+=-1;'],
	['postfix increment', 'i ++;', 'i++;'],
	['attribute before a declaration', '@workgroup_size(64, 1, 1) fn main() {}', '@workgroup_size(64,1,1)fn main(){}'],
	['nested generics', 'var<private> a: array<vec2<f32>, 4>;', 'var<private>a:array<vec2<f32>,4>;'],
	['numeric suffixes and exponent', 'let a = 1e-3 + 0.5f - 2u;', 'let a=1e-3+0.5f-2u;'],
	['swizzles and members', 'let v = p.xyz + q.w;', 'let v=p.xyz+q.w;'],
	['return arrow', 'fn f(a: f32) -> f32 { return a; }', 'fn f(a:f32)->f32{return a;}'],
	['else if keeps its space', 'if (a) { } else if (b) { }', 'if(a){}else if(b){}'],
	['trailing line comment', 'let a = 1; // end', 'let a=1;'],
];

test.each(MINIFY)('minifies %s', (_name, src, expected) => {
	expect(minifyWgsl(src)).toBe(expected);
});

/** Substrings that must survive the rename, and names that must be gone. */
const RENAME: [string, string, string[], string[]][] = [
	['struct members', 'struct S{alpha:f32}var<private>V:S;fn go()->f32{let alpha=1;return V.alpha+alpha;}', ['V.alpha', 'S{alpha:f32}'], []],
	['swizzle spelling of a local', 'fn go()->f32{let xy=1;let v=vec2f(1);return v.xy.x+f32(xy);}', ['let xy=1', 'v.xy.x'], ['go']],
	['return arrow', 'fn helper()->f32{return 1;}fn other()->f32{return helper();}', ['->f32{return 1;}'], ['helper', 'other']],
	['nested generics', 'var<private>counter:array<vec2<f32>,4>;fn go(){counter[0]=vec2f(1);}', ['array<vec2<f32>,4>'], ['counter', 'go']],
	['attributes and builtins', '@fragment fn main(@location(0)fragcolor:vec4f)->@location(0)vec4f{return fragcolor;}', ['@fragment', '@location(0)', 'vec4f'], ['fragcolor', 'main']],
	['hex and float literals', 'fn go(){let ab=1;let q=0xab+ab;let r=1.5f+1e3;}', ['0xab', '1.5f', '1e3'], ['ab']],
	['builtin calls', 'fn go(){let sat=max(sin(1.0),textureSample(t,s,uv).x);}', ['max(sin(1.0)', 'textureSample('], ['sat']],
	['keywords', 'fn go(){loop{continuing{break if true;}}}', ['loop{continuing{break if true;}}'], ['go']],
];

test.each(RENAME)('renames %s', (_name, src, keeps, drops) => {
	const out = renameWgsl(src);
	for (const keep of keeps) expect(out).toContain(keep);
	for (const drop of drops) expect(out).not.toMatch(new RegExp(`(?<![.\\w])${drop}(?!\\w)`));
});

const RESERVED = new Set(
	'alias as break case const const_assert continue continuing default diagnostic discard do else enable false fn for if in let loop of override requires return struct switch true var while'.split(' '),
);

test('never produces a keyword, a reserved word or a duplicate over 300 names', () => {
	const names = Array.from({ length: 300 }, (_, i) => `name${i}`);
	const src = names.map(n => `fn ${n}(){}`).join('') + names.map(n => `${n}();`).join('');
	const out = renameWgsl(src);
	const declared = [...out.matchAll(/fn (\w+)\(/g)].map(m => m[1]!);
	expect(declared).toHaveLength(300);
	expect(new Set(declared).size).toBe(300);
	for (const n of declared) {
		expect(RESERVED.has(n)).toBe(false);
		expect(n).toMatch(/^[A-Za-z]\w?$/);
	}
});

test('substitution leaves longer names and member reads of other names alone', () => {
	expect(substituteConstants('SEAX.SEA SEA', { SEA: 24 })).toBe('SEAX.24 24');
});

test('the real shader keeps its head after substitution, minification and renaming', () => {
	const consts = Object.fromEntries(Object.entries(world).filter((e): e is [string, number] => typeof e[1] == 'number'));
	const shader = renameWgsl(minifyWgsl(substituteConstants(require('node:fs').readFileSync(`${import.meta.dir}/../src/shader.wgsl`, 'utf8') as string, consts)));
	expect(shader.slice(0, 80)).toMatchInlineSnapshot(`"struct ac{p:vec3f,t:f32,r:vec2f,a:vec2f,s:f32,h:f32}@group(0)@binding(0)var<stor"`);
});
