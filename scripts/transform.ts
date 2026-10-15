/** AST rewrites that make a script smaller or more repetitive for deflate while keeping what it does. Every binding has a unique name when they run. */
import type { ArrowFunctionExpression, CallExpression, Expression, Node, Program, Statement, VariableDeclarator } from 'estree';
import { Bindings } from './rename.ts';

export type Visitor = (node: Node) => Node | void;

/** Post-order walk, a visitor result replaces the node it was called with. */
export function walk<T extends Node>(node: T, visit: Visitor): T {
	for (const [key, value] of Object.entries(node)) {
		if (key === 'range' || !value || typeof value !== 'object') continue;
		if (Array.isArray(value)) value.forEach((v, i) => v && typeof v.type === 'string' && (value[i] = walk(v, visit)));
		else if (typeof (value as Node).type === 'string') (node as unknown as Record<string, Node>)[key] = walk(value as Node, visit);
	}
	return (visit(node) as T | undefined) ?? node;
}

/** Whether a node of `type` exists inside `node`, nested functions included. */
const contains = (node: Node, types: Set<string>): boolean => {
	let found = false;
	walk(node, n => void (found ||= types.has(n.type)));
	return found;
};

const lists = (node: Node): Statement[][] => (node.type === 'Program' || node.type === 'BlockStatement' ? [node.body as Statement[]] : node.type === 'SwitchCase' ? [node.consequent] : []);

/** `+!!x` and `+!x` in arithmetic read the booleans as numbers anyway. */
const dropUnaryPlus: Visitor = node => {
	if (node.type === 'BinaryExpression' && /^[-*/%]$/.test(node.operator))
		for (const side of ['left', 'right'] as const) {
			const x = node[side] as Expression;
			if (x.type === 'UnaryExpression' && x.operator === '+' && x.argument.type !== 'Literal') node[side] = x.argument;
		}
};

/** No call, assignment or update inside: the expression can move past another one. */
const pure = (n: Node): boolean => {
	switch (n.type) {
		case 'Identifier':
		case 'Literal':
			return true;
		case 'MemberExpression':
			return pure(n.object) && (!n.computed || pure(n.property));
		case 'BinaryExpression':
		case 'LogicalExpression':
			return pure(n.left) && pure(n.right);
		case 'UnaryExpression':
			return n.operator !== 'delete' && pure(n.argument);
		default:
			return false;
	}
};

/** Only `<` and `<=` in the output, `x>3` is `3<x`: the repeats compress better. The operands swap only when the order does not show. */
const lessThan: Visitor = node => {
	if (node.type !== 'BinaryExpression' || (node.operator !== '>' && node.operator !== '>=')) return;
	const [a, b] = [node.left as Expression, node.right];
	if (!(a.type === 'Literal' || b.type === 'Literal' || (pure(a) && pure(b)))) return;
	node.operator = node.operator === '>' ? '<' : '<=';
	[node.left, node.right] = [b, a];
};

/** The shortest decimal form of a number: `.5`, `1e3`, `1e-4`. */
const shortest = (value: number) => {
	const plain = String(value).replace(/^(-?)0\./, '$1.');
	const [, digits = '', zeros = ''] = /^(\d*?)(0+)$/.exec(plain) ?? [];
	const small = /^\.(0+)(\d+)$/.exec(plain);
	const exponent = zeros.length > 2 ? `${digits}e${zeros.length}` : small ? `${small[2]}e-${small[1]!.length + small[2]!.length}` : plain;
	return exponent.length < plain.length ? exponent : plain;
};

/** Number literals in their shortest form. */
const numbers: Visitor = node => {
	if (node.type === 'Literal' && typeof node.value === 'number' && /^[\d.]/.test(node.raw ?? '') && /^[\d.eE+-]+$/.test(node.raw!)) node.raw = shortest(node.value);
};

/** `true` is `!0` and `false` is `!1`. */
const booleans: Visitor = node => {
	if (node.type === 'Literal' && typeof node.value === 'boolean') return { argument: { raw: node.value ? '0' : '1', type: 'Literal', value: node.value ? 0 : 1 }, operator: '!', prefix: true, type: 'UnaryExpression' };
};

/** A literal first in an equality and a product: `x==3` is `3==x`, `a.x*.002` is `.002*a.x`. */
const literalFirst: Visitor = node => {
	if (node.type === 'BinaryExpression' && (/^[!=]==?$/.test(node.operator) || node.operator === '*') && node.right.type === 'Literal' && node.left.type !== 'Literal') [node.left, node.right] = [node.right, node.left as Expression];
};

/** `a();b();` is `a(),b();`, and a statement before a `return`, `if` or `for` moves into its expression: `a();return b` is `return a(),b`. */
const sequences: Visitor = node => {
	const seq = (a: Expression, b: Expression): Expression => ({ expressions: [...(a.type === 'SequenceExpression' ? a.expressions : [a]), ...(b.type === 'SequenceExpression' ? b.expressions : [b])], type: 'SequenceExpression' });
	for (const list of lists(node))
		for (let i = list.length - 1; i > 0; i--) {
			const [a, b] = [list[i - 1]!, list[i]!];
			if (a.type !== 'ExpressionStatement') continue;
			if (b.type === 'ExpressionStatement') b.expression = seq(a.expression, b.expression);
			else if (b.type === 'ReturnStatement' && b.argument) b.argument = seq(a.expression, b.argument);
			else if (b.type === 'IfStatement') b.test = seq(a.expression, b.test);
			else if (b.type === 'ForStatement' && b.init?.type !== 'VariableDeclaration') b.init = b.init ? seq(a.expression, b.init) : a.expression;
			else continue;
			list.splice(i - 1, 1);
		}
};

/** `var a=1;var b=2;` is `var a=1,b=2;`. */
const mergeVars: Visitor = node => {
	for (const list of lists(node))
		for (let i = list.length - 1; i > 0; i--) {
			const [a, b] = [list[i - 1]!, list[i]!];
			if (a.type === 'VariableDeclaration' && b.type === 'VariableDeclaration' && a.kind === b.kind) {
				a.declarations.push(...b.declarations);
				list.splice(i, 1);
			}
		}
};

/** `({queue:x}=device)` is `x=device.queue`. */
const destructure: Visitor = node => {
	if (node.type !== 'AssignmentExpression' || node.operator !== '=' || node.left.type !== 'ObjectPattern' || node.left.properties.length !== 1) return;
	const [p] = node.left.properties;
	if (p?.type !== 'Property' || p.computed || p.key.type !== 'Identifier' || p.value.type !== 'Identifier') return;
	return { left: p.value, operator: '=', right: { computed: false, object: node.right, optional: false, property: p.key, type: 'MemberExpression' }, type: 'AssignmentExpression' };
};

const range = (n: object) => (n as { range: [number, number] }).range;
const FUNCTIONS = new Set(['ArrowFunctionExpression', 'FunctionExpression']);

/** Removes `dead` declarators and the declarations and empty statements that leaves behind. */
const prune = (ast: Program, dead: Set<unknown>) =>
	walk(ast, n => {
		if (n.type === 'VariableDeclaration') n.declarations = n.declarations.filter(d => !dead.has(d));
		lists(n).forEach(list => list.splice(0, list.length, ...list.filter(s => s.type !== 'EmptyStatement' && (s.type !== 'VariableDeclaration' || s.declarations.length))));
	});

/** A function bound once and read once moves to where it is read: `var f=a=>a+1;g(f)` is `g(a=>a+1)`. */
const inlineOnce = (ast: Program) => {
	const bindings = new Bindings(ast);
	const moves = new Map<object, Expression>();
	const dead = new Set<VariableDeclarator>();
	for (const variable of bindings.variables) {
		const [def] = variable.defs;
		const init = (def?.node as VariableDeclarator | undefined)?.init;
		if (variable.defs.length !== 1 || def!.type !== 'Variable' || !init || (init.type !== 'ArrowFunctionExpression' && init.type !== 'FunctionExpression')) continue;
		const reads = variable.references.filter(r => !r.init);
		const [read] = reads;
		if (reads.length !== 1 || !read!.isRead() || read!.isWrite() || (range(read!.identifier)[0] >= range(init)[0] && range(read!.identifier)[0] < range(init)[1]) || contains(init, new Set(['ThisExpression', 'Super', 'MetaProperty']))) continue;
		moves.set(read!.identifier, init);
		dead.add(def!.node as VariableDeclarator);
	}
	if (moves.size) (walk(ast, n => moves.get(n) as Node | undefined), prune(ast, dead));
};

const NUMERIC: Record<string, (a: number, b: number) => number> = { '%': (a, b) => a % b, '&': (a, b) => a & b, '*': (a, b) => a * b, '**': (a, b) => a ** b, '+': (a, b) => a + b, '-': (a, b) => a - b, '/': (a, b) => a / b, '<<': (a, b) => a << b, '>>': (a, b) => a >> b, '>>>': (a, b) => a >>> b, '^': (a, b) => a ^ b, '|': (a, b) => a | b };
const value = (n: Node) => (n.type === 'Literal' && typeof n.value === 'number' ? n.value : n.type === 'UnaryExpression' && n.operator === '-' && n.argument.type === 'Literal' && typeof n.argument.value === 'number' ? -n.argument.value : undefined);
const literal = (v: number): Expression => (v < 0 || Object.is(v, -0) ? { argument: literal(-v), operator: '-', prefix: true, type: 'UnaryExpression' } : { raw: shortest(v), type: 'Literal', value: v });

/** `1024*1024` is `1048576`. */
const fold: Visitor = node => {
	if (node.type !== 'BinaryExpression' || !(node.operator in NUMERIC)) return;
	const [a, b] = [value(node.left), value(node.right)];
	const result = a === undefined || b === undefined ? NaN : NUMERIC[node.operator]!(a, b);
	if (Number.isFinite(result) && !Object.is(result, -0)) return literal(result);
};

/** A binding set once to a number and never written again is the number: `var SIZE=1024;SIZE-1` is `1023`. A string moves to its only read. */
const inlineConstants = (ast: Program) => {
	for (let again = true; again; ) {
		again = false;
		walk(ast, fold);
		const swaps = new Map<object, () => Expression>();
		const dead = new Set<unknown>();
		for (const variable of new Bindings(ast).variables) {
			const [def] = variable.defs;
			const init = (def?.node as VariableDeclarator | undefined)?.init;
			const v = init ? value(init) : undefined;
			const reads = variable.references.filter(r => !r.init);
			const text = init?.type === 'Literal' && typeof init.value === 'string' && reads.length === 1 ? init : undefined;
			if (variable.defs.length !== 1 || def!.type !== 'Variable' || (v === undefined && !text) || reads.some(r => r.isWrite())) continue;
			reads.forEach(r => swaps.set(r.identifier, () => (text ?? literal(v!))));
			dead.add(def!.node);
		}
		if (dead.size) (walk(ast, n => swaps.get(n)?.() as Node | undefined), prune(ast, dead), (again = true));
	}
};

/** `if(!x)return;a();b()` is `x&&(a(),b())`. */
const guard: Visitor = node => {
	if (!FUNCTIONS.has(node.type)) return;
	const { body } = node as ArrowFunctionExpression;
	if (body.type !== 'BlockStatement') return;
	const [first, ...rest] = body.body;
	if (first?.type !== 'IfStatement' || first.alternate || first.test.type !== 'UnaryExpression' || first.test.operator !== '!' || (first.consequent.type !== 'ReturnStatement' && !(first.consequent.type === 'BlockStatement' && first.consequent.body.length === 1 && first.consequent.body[0]!.type === 'ReturnStatement'))) return;
	const ret = first.consequent.type === 'ReturnStatement' ? first.consequent : (first.consequent.body[0] as Extract<Statement, { type: 'ReturnStatement' }>);
	if (ret.argument || !rest.length || !rest.every(s => s.type === 'ExpressionStatement')) return;
	body.body = [{ expression: { left: first.test.argument, operator: '&&', right: rest.length === 1 ? (rest[0] as Extract<Statement, { type: 'ExpressionStatement' }>).expression : { expressions: rest.map(s => (s as Extract<Statement, { type: 'ExpressionStatement' }>).expression), type: 'SequenceExpression' }, type: 'LogicalExpression' }, type: 'ExpressionStatement' }];
};

/** Bindings that nothing reads and whose value has no effect go away, and so do `if` statements on a literal. */
const dropDead = (ast: Program) => {
	const dead = new Set<unknown>();
	for (const variable of new Bindings(ast).variables) {
		const [def] = variable.defs;
		const init = (def?.node as VariableDeclarator | undefined)?.init;
		if (variable.defs.length === 1 && def!.type === 'Variable' && (!init || pure(init) || FUNCTIONS.has(init.type)) && variable.references.every(r => r.init)) dead.add(def!.node);
	}
	walk(ast, n => {
		if (n.type === 'IfStatement' && n.test.type === 'Literal') return (n.test.value ? n.consequent : n.alternate) ?? { type: 'EmptyStatement' };
	});
	prune(ast, dead);
};

/** `let` and `const` are `var` when no closure can tell, which merges declarations and repeats one keyword. */
const varify = (ast: Program) => {
	const LOOPS = /^(For|ForIn|ForOf|While|DoWhile)Statement$/;
	const FUNCTION_TYPES = new Set([...FUNCTIONS, 'FunctionDeclaration']);
	/** `loop` is undefined outside loops, else whether a closure sits in the outermost loop. */
	const go = (n: Node, loop: boolean | undefined, inFunction: boolean, head = false) => {
		if (inFunction && n.type === 'VariableDeclaration' && n.kind !== 'var' && loop !== true && (loop === undefined || head || n.declarations.every(d => d.init))) n.kind = 'var';
		const inner = FUNCTION_TYPES.has(n.type) ? undefined : (loop ?? (LOOPS.test(n.type) ? contains(n, FUNCTION_TYPES) : undefined));
		for (const [key, child] of Object.entries(n)) {
			if (key === 'range' || !child || typeof child !== 'object') continue;
			for (const c of Array.isArray(child) ? child : [child]) if (c && typeof c.type === 'string') go(c, inner, inFunction || FUNCTION_TYPES.has(n.type), (n.type === 'ForInStatement' || n.type === 'ForOfStatement') && key === 'left');
		}
	};
	go(ast, undefined, false);
};

/** A call of a function with an expression body becomes the body: `var k=a=>+!!keys[a];k("W")` is `+!!keys.W`. Arguments are copied in when they are literals or names, or pure and used once. */
const inlineCalls = (ast: Program) => {
	const bindings = new Bindings(ast);
	const calls = new Map<object, Expression>();
	const dead = new Set<unknown>();
	const callOf = new Map<object, CallExpression>();
	walk(ast, n => void (n.type === 'CallExpression' && callOf.set(n.callee, n)));
	for (const variable of bindings.variables) {
		const [def] = variable.defs;
		const fn = (def?.node as VariableDeclarator | undefined)?.init;
		if (variable.defs.length !== 1 || def!.type !== 'Variable' || !fn || !FUNCTIONS.has(fn.type) || variable.references.some(r => !r.init && (r.isWrite() || !callOf.has(r.identifier)))) continue;
		const { body, params } = fn as ArrowFunctionExpression;
		const expression = body.type !== 'BlockStatement' ? body : body.body.length === 1 && body.body[0]!.type === 'ReturnStatement' ? body.body[0]!.argument : undefined;
		const names = params.map(p => (p.type === 'Identifier' ? p.name : ''));
		if (!expression || names.includes('') || contains(expression, new Set(['ThisExpression', 'AssignmentExpression', 'UpdateExpression', 'FunctionExpression', 'ArrowFunctionExpression', 'YieldExpression', 'AwaitExpression']))) continue;
		const uses = (name: string) => {
			let count = 0;
			walk(expression, n => void (n.type === 'Identifier' && n.name === name && count++));
			return count;
		};
		const reads = variable.references.filter(r => !r.init);
		const fits = reads.every(r => {
			const { arguments: args } = callOf.get(r.identifier)!;
			return args.length === names.length && args.every((a, i) => a.type === 'Literal' || a.type === 'Identifier' || (a.type !== 'SpreadElement' && uses(names[i]!) <= 1 && pure(a)));
		});
		if (!fits || (reads.length > 1 && range(expression)[1] - range(expression)[0] > 40)) continue;
		for (const r of reads) {
			const call = callOf.get(r.identifier)!;
			const copy = structuredClone(expression);
			calls.set(call, walk(copy, n => (n.type === 'Identifier' && names.includes(n.name) ? (structuredClone(call.arguments[names.indexOf(n.name)]) as Node) : undefined)));
		}
		dead.add(def!.node);
	}
	if (dead.size) (walk(ast, n => calls.get(n) as Node | undefined), prune(ast, dead));
};

/** The rewrites, by name, in the order they run. */
export const REWRITES: Record<string, (ast: Program) => void> = {
	inlineConstants,
	dropDead,
	varify,
	inlineCalls,
	inlineOnce,
	...Object.fromEntries(Object.entries({ fold, booleans, destructure, dropUnaryPlus, guard, lessThan, literalFirst, numbers, sequences, mergeVars }).map(([name, visit]) => [name, (ast: Program) => void walk(ast, visit)])),
};

export const transform = (ast: Program, names = Object.keys(REWRITES)) => names.forEach(name => REWRITES[name]!(ast));
