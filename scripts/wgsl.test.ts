import { expect, test } from 'bun:test';
import * as world from '../src/world.ts';
import { shader } from './shader.ts';
import { assertRenamed, items, letToVar, minifyWgsl, renameWgsl, substituteConstants } from './wgsl.ts';

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
	expect(renameWgsl(src)).toBe('struct a{p:vec3f,t:f32}@group(0)@binding(0)var<uniform>U:a;fn b(d:vec3f,e:f32)->f32{let f=d.x*e+U.t;var a=0;for(var c=0;c<4;c++){a+=1;}return f+f32(a)+b(d.yzx,e);}');
});

test('a local takes any letter but the globals its function reads', () => {
	const out = renameWgsl('var<private>a:f32;fn first(){let long=1.;a=long;}fn second(){let other=2.;let more=other;}');
	expect(out).toBe('var<private>a:f32;fn b(){let c=1.;a=c;}fn c(){let a=2.;let b=a;}');
});

test('renames parameters that follow an attribute and never picks a reserved word', () => {
	const out = renameWgsl('@vertex fn vert(@builtin(vertex_index)index:u32)->@builtin(position)vec4f{return vec4f(f32(index));}');
	expect(out).toBe('@vertex fn a(@builtin(vertex_index)b:u32)->@builtin(position)vec4f{return vec4f(f32(b));}');
});

test('keeps the arguments of @builtin and @interpolate even when a local is named like them', () => {
	const out = renameWgsl('fn f(@builtin(position)position:vec4f,@location(0)@interpolate(flat)flat:u32)->@location(0)vec4f{return position+vec4f(f32(flat));}');
	expect(out).toBe('fn f(@builtin(position)b:vec4f,@location(0)@interpolate(flat)a:u32)->@location(0)vec4f{return b+vec4f(f32(a));}');
});

/** Substrings that must survive the rename, and names that must be gone. */
const RENAME: [string, string, string[], string[]][] = [
	['struct members', 'struct S{alpha:f32}var<private>V:S;fn go()->f32{let alpha=1;return V.alpha+alpha;}', ['V.alpha', 'S{alpha:f32}'], []],
	['swizzle spelling of a local', 'fn go()->f32{let xy=1;let v=vec2f(1);return v.xy.x+f32(xy);}', ['.xy.x'], ['go', 'xy']],
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

const LET_TO_VAR: [string, string, string][] = [
	['plain lets', 'fn f(){let a=1;let b:f32=a+2;}', 'fn f(){var a=1;var b:f32=a+2;}'],
	['for initializer', 'fn f(){for(let i=0;i<4;i++){}}', 'fn f(){for(var i=0;i<4;i++){}}'],
	['a bitwise and is not an address', 'fn f(){let a=b&c;}', 'fn f(){var a=b&c;}'],
	['address-of stays a let', 'fn f(){let p=&x;let q=&(*p);}', 'fn f(){let p=&x;let q=&(*p);}'],
	['pointer type stays a let', 'fn f(p:ptr<function,i32>){let q:ptr<function,i32>=p;}', 'fn f(p:ptr<function,i32>){let q:ptr<function,i32>=p;}'],
	['a bare name may be a pointer, texture or sampler', 'fn f(p:ptr<function,i32>){let q=p;let r=q+1;}', 'fn f(p:ptr<function,i32>){let q=p;var r=q+1;}'],
	['names that only contain let', 'fn f(){let letter=1;outlet(letter);}', 'fn f(){var letter=1;outlet(letter);}'],
];

test.each(LET_TO_VAR)('turns let into var: %s', (_name, src, expected) => {
	expect(letToVar(src)).toBe(expected);
});

const deflated = (s: string) => Bun.deflateSync(s, { level: 12, library: 'libdeflate' }).length;

test('the annealed rename is deterministic, a rename of the greedy one and never larger', async () => {
	const src = letToVar(minifyWgsl(substituteConstants(await Bun.file(`${import.meta.dir}/../src/shader.wgsl`).text(), Object.fromEntries(Object.entries(world).filter((e): e is [string, number] => typeof e[1] == 'number')))));
	const greedy = renameWgsl(src);
	const annealed = renameWgsl(src, 300);
	expect(renameWgsl(src, 300)).toBe(annealed);
	expect(deflated(annealed)).toBeLessThanOrEqual(deflated(greedy));
	expect(annealed.length).toBe(greedy.length);
	expect([...items(annealed)].sort().join('').length).toBe(annealed.length);
	for (const word of ['fn', 'for', 'return', 'select', 'textureStore', '@compute@workgroup_size(64)']) expect(annealed.split(word).length).toBe(greedy.split(word).length);
});

test('directives stay first when the declarations are reordered', () => {
	const src = 'enable f16;diagnostic(off,derivative_uniformity);fn alpha(){}fn beta(){alpha();}fn gamma(){beta();alpha();}';
	expect(renameWgsl(src, 200).startsWith('enable f16;diagnostic(off,derivative_uniformity);')).toBe(true);
});

test('a struct member spelled like a global is not renamed with it', () => {
	const out = renameWgsl('struct S{alpha:f32}var<private>alpha:S;fn go()->f32{return alpha.alpha;}', 100);
	expect(out).toContain('S{alpha:f32}'.replace('S', out.match(/struct (\w+)/)![1]!));
	expect(out).toMatch(/\.alpha;/);
});

test('assertRenamed accepts a consistent rename and rejects a capture, a merge and a split global', () => {
	const before = ['var<private>g:f32;', 'fn f(){let x=g;return x;}'];
	expect(() => assertRenamed(before, ['var<private>a:f32;', 'fn b(){let c=a;return c;}'])).not.toThrow();
	expect(() => assertRenamed(before, ['var<private>a:f32;', 'fn b(){let a=a;return a;}'])).toThrow();
	expect(() => assertRenamed(before, ['var<private>a:f32;', 'fn b(){let c=a;return d;}'])).toThrow();
	expect(() => assertRenamed(before, ['var<private>a:f32;', 'fn b(){let c=z;return c;}'])).toThrow();
	expect(() => assertRenamed(before, ['var<private>a:f32;', 'fn a(){let c=a;return c;}'])).toThrow();
});

test('substitutes whole words only, longest names first, and leaves member reads of other names alone', () => {
	expect(substituteConstants('SEA SEAX SEA_LEVEL STONE', { SEA: 24, SEA_LEVEL: 25, STONE: 4 })).toBe('24 SEAX 25 4');
	expect(substituteConstants('SEAX.SEA SEA', { SEA: 24 })).toBe('SEAX.24 24');
});

test('the real shader comes out substituted, minified and renamed', async () => {
	const out = await shader(`${import.meta.dir}/../src/shader.wgsl`);
	expect(out).not.toMatch(/\/\/|\/\*|\s{2,}|\n/);
	for (const name of Object.keys(world).filter(n => n.length > 2 && typeof world[n as keyof typeof world] == 'number')) expect(out).not.toMatch(new RegExp(`\\b${name}\\b`));
	const members = new Set(out.match(/(?<=\.)\w+/g));
	const declared = [...out.matchAll(/\b(?:fn|let|const|struct)\s+(\w+)|\bvar(?:<[^>]*>|\s)\s*(\w+)|[(,)]\s*(\w+)\s*:/g)].map(m => m[1] ?? m[2] ?? m[3]!);
	expect(declared.length).toBeGreaterThan(0);
	expect(declared.filter(n => n.length > 2 && !members.has(n))).toEqual([]);
}, 120_000);
