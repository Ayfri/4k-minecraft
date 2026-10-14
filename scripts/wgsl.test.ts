import { expect, test } from 'bun:test';
import { minifyWgsl, renameWgsl, substituteConstants } from './wgsl.ts';

test('renames declared names consistently and keeps members, swizzles, builtins and i++', () => {
	const src = 'struct Uni{p:vec3f,t:f32}@group(0)@binding(0)var<uniform>U:Uni;fn helper(pos:vec3f,scale:f32)->f32{let total=pos.x*scale+U.t;var count=0;for(var i=0;i<4;i++){count+=1;}return total+f32(count)+helper(pos.yzx,scale);}';
	expect(renameWgsl(src)).toBe('struct d{p:vec3f,t:f32}@group(0)@binding(0)var<uniform>U:d;fn e(b:vec3f,c:f32)->f32{let f=b.x*c+U.t;var a=0;for(var i=0;i<4;i++){a+=1;}return f+f32(a)+e(b.yzx,c);}');
});

test('keeps a name that is also read after a dot', () => {
	expect(renameWgsl('struct S{alpha:f32}var<private>V:S;fn go()->f32{let alpha=1;return V.alpha+alpha;}')).toContain('V.alpha');
});

test('renames parameters that follow an attribute and never picks a reserved word', () => {
	const out = renameWgsl('@vertex fn vert(@builtin(vertex_index)index:u32)->@builtin(position)vec4f{return vec4f(f32(index));}');
	expect(out).toBe('@vertex fn b(@builtin(vertex_index)a:u32)->@builtin(position)vec4f{return vec4f(f32(a));}');
});

test('strips line and block comments', () => {
	expect(minifyWgsl('let a = 1; // one\n/* two\nlines */ let b = 2;')).toBe('let a=1;let b=2;');
});

test('keeps increments and the spaces between words', () => {
	expect(minifyWgsl('for (var i = 0; i < n; i++) { K = B(C); }')).toBe('for(var i=0;i<n;i++){K=B(C);}');
});

test('never merges a - -b into a decrement', () => {
	expect(minifyWgsl('let x = a - -b;')).toBe('let x=a- -b;');
	expect(minifyWgsl('let x = a + +b;')).toBe('let x=a+ +b;');
	expect(minifyWgsl('let x = a - b - c;')).toBe('let x=a-b-c;');
});

test('keeps declarations valid', () => {
	expect(minifyWgsl('fn v(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return vec4f(); }')).toBe(
		'fn v(@builtin(vertex_index)i:u32)->@builtin(position)vec4f{return vec4f();}',
	);
	expect(minifyWgsl('var<private> C: vec3i;')).toBe('var<private>C:vec3i;');
	expect(minifyWgsl('@group(0) @binding(0) var<storage, read_write> W: array<u32>;')).toBe('@group(0)@binding(0)var<storage,read_write>W:array<u32>;');
});

test('substitutes whole words only, longest names first', () => {
	const out = substituteConstants('SEA SEAX SEA_LEVEL STONE', { SEA: 24, SEA_LEVEL: 25, STONE: 4 });
	expect(out).toBe('24 SEAX 25 4');
});
