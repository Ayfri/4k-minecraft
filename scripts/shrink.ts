/** The in-house minifier: parse once, give every binding a unique name, rewrite the AST, print it compactly and let the renamer pick the names by deflate size. */
import { parse } from 'acorn';
import type { Identifier, Program } from 'estree';
import { Printer } from './print.ts';
import { Bindings, chooseNames, type Shader } from './rename.ts';
import { transform } from './transform.ts';

/** `shader`, when the script holds it as a string, is renamed together with the script. */
export function shrink(js: string, rounds?: number, rewrites?: string[], shader?: Shader) {
	const ast = parse(js, { ecmaVersion: 'latest', ranges: true, sourceType: 'script' }) as unknown as Program;
	/** Unique names make moving code between scopes capture-free, the renamer resolves them again after the rewrites. */
	for (const [id, i] of new Bindings(ast).byNode) (id as Identifier).name = `#${i}`;
	transform(ast, rewrites);
	const bindings = new Bindings(ast);
	return chooseNames(new Printer(bindings.byNode).program(ast), bindings, rounds, shader);
}
