import { expect, test } from 'bun:test';
import { shader } from './shader.ts';
import { minifyWgsl, renameWgsl, substituteConstants } from './wgsl.ts';

const MINIFY: [string, string, string][] = [
	['line and block comments', 'let a = 1; // one\n/* two\nlines */ let b = 2;', 'let a=1;let b=2;'],
	['spaces around a comparison', 'a  <  b', 'a<b'],
	['shift', 'x = a << 2u;', 'x=a<<2u;'],
	['logic and comparison chain', 'x = a >= b && c != d || !e;', 'x=a>=b&&c!=d||!e;'],
	['unary minus after binary minus', 'x = -a - -b;', 'x=-a- -b;'],
	['binary plus and unary plus', 'x = a + +b;', 'x=a+ +b;'],
	['chained minus', 'x = a - b - c;', 'x=a-b-c;'],
	['comment between two minus signs', 'a -/*c*/- b', 'a- -b'],
	['compound assignment with a negative', 'a += -1;', 'a+=-1;'],
	['postfix increment', 'i ++;', 'i++;'],
	['increments and the spaces between words', 'for (var i = 0; i < n; i++) { K = B(C); }', 'for(var i=0;i<n;i++){K=B(C);}'],
	['attribute before a declaration', '@workgroup_size(64, 1, 1) fn main() {}', '@workgroup_size(64,1,1)fn main(){}'],
	['attribute on a parameter', 'fn v(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return vec4f(); }', 'fn v(@builtin(vertex_index)i:u32)->@builtin(position)vec4f{return vec4f();}'],
	['private variable', 'var<private> C: vec3i;', 'var<private>C:vec3i;'],
	['storage variable', '@group(0) @binding(0) var<storage, read_write> W: array<u32>;', '@group(0)@binding(0)var<storage,read_write>W:array<u32>;'],
	['nested generics', 'var<private> a: array<vec2<f32>, 4>;', 'var<private>a:array<vec2<f32>,4>;'],
	['numeric suffixes and exponent', 'let a = 1e-3 + 0.5f - 2u;', 'let a=1e-3+0.5f-2u;'],
	['swizzles and members', 'let v = p.xyz + q.w;', 'let v=p.xyz+q.w;'],
	['return arrow', 'fn f(a: f32) -> f32 { return a; }', 'fn f(a:f32)->f32{return a;}'],
	['else if keeps its space', 'if (a) { } else if (b) { }', 'if(a){}else if(b){}'],
];

test.each(MINIFY)('minifies %s', (_name, src, expected) => {
	expect(minifyWgsl(src)).toBe(expected);
});

test('renames declared names consistently and keeps members, swizzles, builtins and i++', () => {
	const src = 'struct Uni{p:vec3f,t:f32}@group(0)@binding(0)var<uniform>U:Uni;fn helper(pos:vec3f,scale:f32)->f32{let total=pos.x*scale+U.t;var count=0;for(var i=0;i<4;i++){count+=1;}return total+f32(count)+helper(pos.yzx,scale);}';
	expect(renameWgsl(src)).toBe('struct d{p:vec3f,t:f32}@group(0)@binding(0)var<uniform>U:d;fn e(b:vec3f,c:f32)->f32{let f=b.x*c+U.t;var a=0;for(var i=0;i<4;i++){a+=1;}return f+f32(a)+e(b.yzx,c);}');
});

test('renames parameters that follow an attribute and never picks a reserved word', () => {
	const out = renameWgsl('@vertex fn vert(@builtin(vertex_index)index:u32)->@builtin(position)vec4f{return vec4f(f32(index));}');
	expect(out).toBe('@vertex fn b(@builtin(vertex_index)a:u32)->@builtin(position)vec4f{return vec4f(f32(a));}');
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

test('substitutes whole words only, longest names first, and leaves member reads of other names alone', () => {
	expect(substituteConstants('SEA SEAX SEA_LEVEL STONE', { SEA: 24, SEA_LEVEL: 25, STONE: 4 })).toBe('24 SEAX 25 4');
	expect(substituteConstants('SEAX.SEA SEA', { SEA: 24 })).toBe('SEAX.24 24');
});

test('the real shader keeps its head after substitution, minification and renaming', async () => {
	expect((await shader(`${import.meta.dir}/../src/shader.wgsl`, true)).slice(0, 80)).toMatchInlineSnapshot(`"struct ac{p:vec3f,t:f32,a:vec3f,s:f32,r:vec2f,h:f32}@group(0)@binding(0)var<stor"`);
});
