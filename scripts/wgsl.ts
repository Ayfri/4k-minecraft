/** Strips comments and every space WGSL does not need, keeping `a - -b` and `a + +b` apart so they never lex as `--` or `++`. */
export const minifyWgsl = (s: string) =>
	s
		.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, ' ')
		.replace(/([+\-&])\s+(?=\1)/g, '$1\u0001')
		.replace(/\s*([^\w\s])\s*/g, '$1')
		.replace(/\s+/g, ' ')
		.replace(/\u0001/g, ' ')
		.trim();

/** Replaces whole-word constant names with their numeric value, as an abstract literal. */
export const substituteConstants = (s: string, consts: Record<string, number>) =>
	s.replace(new RegExp(`\\b(?:${Object.keys(consts).sort((a, b) => b.length - a.length).join('|')})\\b`, 'g'), name => String(consts[name]));
