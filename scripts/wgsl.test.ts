import { expect, test } from 'bun:test';
import { minifyWgsl, substituteConstants } from './wgsl.ts';

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
