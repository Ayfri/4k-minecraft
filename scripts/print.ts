/** A compact JavaScript printer for the syntax a bundle uses: no optional space, semicolon or parenthesis. Bindings come out as indexes so a renamer can fill in the names. */
import type { Expression, Node, Pattern, Program, Statement } from 'estree';

/** A piece of output: text, or the index of a binding whose name is chosen later. */
export type Part = number | string;

const BINARY = ['??', '||', '&&', '|', '^', '&', '== != === !==', '< > <= >= in instanceof', '<< >> >>>', '+ -', '* / %', '**'].flatMap((ops, level) => ops.split(' ').map(op => [op, level + 4] as const));
const PRECEDENCE = new Map<string, number>(BINARY);
/** Binds tighter than any binary operator: unary 17, postfix 18, call/member 19, primary 20. */
const UNARY = 17;
const MEMBER = 19;
const idChar = (c: string | undefined) => !!c && /[\w$]/.test(c);

type Fn = Extract<Node, { params: Pattern[] }>;

export class Printer {
	readonly parts: Part[] = [];

	/** `bindings` maps each declaring or referencing Identifier node to its binding index. */
	constructor(private readonly bindings: Map<object, number>) {}

	private get last() {
		const p = this.parts.at(-1);
		return typeof p === 'number' ? 'a' : p?.at(-1);
	}

	/** Pushes `s`, with the one space that keeps two tokens from gluing together. */
	private w(s: string) {
		const prev = this.last;
		if ((idChar(prev) && idChar(s[0])) || (prev === s[0] && (prev === '+' || prev === '-')) || (prev === '/' && s[0] === '/')) this.parts.push(' ');
		this.parts.push(s);
	}

	/** Prints `f()` and wraps it in parentheses when `wrap` says so from the first token it produced. */
	private wrapIf(wrap: (first: string) => boolean, f: () => void) {
		const mark = this.parts.length;
		f();
		const first = this.parts[mark];
		if (typeof first === 'string' && wrap(first)) {
			this.parts.splice(mark, 0, '(');
			this.parts.push(')');
		}
	}

	private id(node: { name: string }) {
		const binding = this.bindings.get(node);
		if (binding === undefined) return this.w(node.name);
		if (idChar(this.last)) this.parts.push(' ');
		this.parts.push(binding);
	}

	private list(nodes: (Node | null)[], print: (n: Node) => void) {
		nodes.forEach((n, i) => {
			if (i) this.w(',');
			if (n) print(n);
		});
	}

	program(program: Program) {
		this.statements(program.body as Statement[]);
		return this.parts;
	}

	/** Statements joined by `;`, which a block-ending `}` and the last statement do without. */
	private statements(list: Statement[]) {
		list.forEach((s, i) => {
			if (s.type === 'EmptyStatement') return;
			this.statement(s);
			if (i < list.length - 1 && this.needsSemi(s)) this.w(';');
		});
	}

	private needsSemi(s: Statement): boolean {
		switch (s.type) {
			case 'BlockStatement':
			case 'ClassDeclaration':
			case 'EmptyStatement':
			case 'FunctionDeclaration':
			case 'SwitchStatement':
			case 'TryStatement':
				return false;
			case 'LabeledStatement':
				return this.needsSemi(this.inner(s.body));
			case 'IfStatement':
				return this.needsSemi(this.inner(s.alternate ?? s.consequent));
			case 'ForStatement':
			case 'ForInStatement':
			case 'ForOfStatement':
			case 'WhileStatement':
				return this.needsSemi(this.inner(s.body));
			default:
				return true;
		}
	}

	/** The body of a loop or `if` without its braces when it is one statement that can stand alone. */
	private inner(s: Statement) {
		const [only] = s.type === 'BlockStatement' ? s.body : [];
		return only && s.type === 'BlockStatement' && s.body.length === 1 && only.type !== 'VariableDeclaration' && only.type !== 'FunctionDeclaration' && only.type !== 'ClassDeclaration' ? (only as Statement) : s;
	}

	private body(s: Statement, needSemi = false) {
		s = this.inner(s);
		if (s.type === 'EmptyStatement') return void this.w(';');
		this.statement(s);
		if (needSemi && this.needsSemi(s)) this.w(';');
	}

	/** True when a trailing `else` would bind to an `if` inside `s`. */
	private dangling(s: Statement): boolean {
		s = this.inner(s);
		return s.type === 'IfStatement' ? !s.alternate || this.dangling(s.alternate) : s.type === 'ForStatement' || s.type === 'WhileStatement' || s.type === 'ForInStatement' || s.type === 'ForOfStatement' || s.type === 'LabeledStatement' ? this.dangling(s.body) : false;
	}

	private block(list: Statement[]) {
		this.w('{');
		this.statements(list);
		this.w('}');
	}

	private statement(s: Statement) {
		switch (s.type) {
			case 'BlockStatement':
				return this.block(s.body as Statement[]);
			case 'BreakStatement':
			case 'ContinueStatement':
				this.w(s.type === 'BreakStatement' ? 'break' : 'continue');
				return s.label && this.id(s.label as { name: string });
			case 'EmptyStatement':
				return;
			case 'ExpressionStatement':
				return this.wrapIf(
					first => /^(\{|function\b|class\b|async function\b|let\[)/.test(first),
					() => this.expr(s.expression, 0),
				);
			case 'ForInStatement':
			case 'ForOfStatement':
				this.w('for');
				this.w('(');
				this.forHead(s.left);
				this.w(s.type === 'ForInStatement' ? 'in' : 'of');
				this.expr(s.right, s.type === 'ForInStatement' ? 0 : 2);
				this.w(')');
				return this.body(s.body);
			case 'ForStatement':
				this.w('for(');
				if (s.init) this.forHead(s.init);
				this.w(';');
				if (s.test) this.expr(s.test, 0);
				this.w(';');
				if (s.update) this.expr(s.update, 0);
				this.w(')');
				return this.body(s.body);
			case 'FunctionDeclaration':
				return this.fn(s);
			case 'IfStatement':
				this.w('if(');
				this.expr(s.test, 0);
				this.w(')');
				if (s.alternate && this.dangling(s.consequent)) this.block(s.consequent.type === 'BlockStatement' ? (s.consequent.body as Statement[]) : [s.consequent]);
				else this.body(s.consequent, !!s.alternate);
				if (s.alternate) {
					this.w('else');
					this.body(s.alternate);
				}
				return;
			case 'LabeledStatement':
				this.id(s.label as { name: string });
				this.w(':');
				return this.body(s.body);
			case 'ReturnStatement':
			case 'ThrowStatement':
				this.w(s.type === 'ReturnStatement' ? 'return' : 'throw');
				return s.argument && this.expr(s.argument, 0);
			case 'SwitchStatement':
				this.w('switch(');
				this.expr(s.discriminant, 0);
				this.w('){');
				s.cases.forEach(c => {
					if (c.test) {
						this.w('case');
						this.expr(c.test, 0);
					} else this.w('default');
					this.w(':');
					this.statements(c.consequent);
					if (c.consequent.length && this.needsSemi(c.consequent.at(-1)!)) this.w(';');
				});
				return this.w('}');
			case 'TryStatement':
				this.w('try');
				this.block(s.block.body);
				if (s.handler) {
					this.w('catch');
					if (s.handler.param) {
						this.w('(');
						this.pattern(s.handler.param);
						this.w(')');
					}
					this.block(s.handler.body.body);
				}
				if (s.finalizer) {
					this.w('finally');
					this.block(s.finalizer.body);
				}
				return;
			case 'VariableDeclaration':
				this.w(s.kind);
				return this.list(s.declarations, d => {
					const { id, init } = d as { id: Pattern; init?: Expression | null };
					this.pattern(id);
					if (init) {
						this.w('=');
						this.expr(init, 2);
					}
				});
			case 'WhileStatement':
				this.w('while(');
				this.expr(s.test, 0);
				this.w(')');
				return this.body(s.body);
			case 'DoWhileStatement':
				this.w('do');
				this.body(s.body, true);
				this.w('while(');
				this.expr(s.test, 0);
				return this.w(')');
			default:
				throw new Error(`the printer does not support ${s.type}`);
		}
	}

	/** The init of a `for`, a declaration with no `;`. `in` inside it needs parentheses. */
	private forHead(n: Node) {
		if (n.type === 'VariableDeclaration') this.statement(n);
		else this.expr(n as Expression, 0);
	}

	private fn(f: Fn & { async?: boolean; generator?: boolean; id?: { name: string } | null; type: string }) {
		if (f.async) this.w('async');
		if (f.type === 'ArrowFunctionExpression') {
			const [only] = f.params;
			if (f.params.length === 1 && only!.type === 'Identifier') this.pattern(only!);
			else {
				this.w('(');
				this.list(f.params, p => this.pattern(p as Pattern));
				this.w(')');
			}
			this.w('=>');
			const body = (f as unknown as { body: Statement | Expression }).body;
			if (body.type === 'BlockStatement') return this.block(body.body as Statement[]);
			return this.wrapIf(first => first === '{', () => this.expr(body as Expression, 2));
		}
		this.w(f.generator ? 'function*' : 'function');
		if (f.id) this.id(f.id);
		this.w('(');
		this.list(f.params, p => this.pattern(p as Pattern));
		this.w(')');
		this.block((f as unknown as { body: { body: Statement[] } }).body.body);
	}

	private pattern(p: Pattern | Node): void {
		switch (p.type) {
			case 'ArrayPattern':
				this.w('[');
				this.list(p.elements, e => this.pattern(e));
				if (p.elements.at(-1) === null) this.w(',');
				return this.w(']');
			case 'AssignmentPattern':
				this.pattern(p.left);
				this.w('=');
				return this.expr(p.right, 2);
			case 'ObjectPattern':
				this.w('{');
				this.list(p.properties, e => (e.type === 'RestElement' ? this.pattern(e) : this.property(e as never)));
				return this.w('}');
			case 'RestElement':
				this.w('...');
				return this.pattern(p.argument);
			case 'Identifier':
				return this.id(p);
			default:
				return this.expr(p as Expression, MEMBER);
		}
	}

	private property(p: { computed: boolean; key: Expression; kind: string; method: boolean; shorthand: boolean; value: Node }) {
		const { computed, key, kind, method, value } = p;
		const shorthand = key.type === 'Identifier' && !computed && (value.type === 'Identifier' ? !this.bindings.has(value) && value.name === key.name : value.type === 'AssignmentPattern' && value.left.type === 'Identifier' && !this.bindings.has(value.left) && value.left.name === key.name);
		const name = () => (computed ? (this.w('['), this.expr(key, 2), this.w(']')) : key.type === 'Identifier' ? this.w(key.name) : this.expr(key, 2));
		if (shorthand) return this.pattern(value);
		if (method || kind === 'get' || kind === 'set') {
			const f = value as { async?: boolean; generator?: boolean };
			if (kind !== 'init') this.w(kind);
			if (f.async) this.w('async');
			if (f.generator) this.w('*');
			name();
			this.w('(');
			this.list((value as Fn).params, q => this.pattern(q as Pattern));
			this.w(')');
			return this.block((value as unknown as { body: { body: Statement[] } }).body.body);
		}
		name();
		this.w(':');
		if (value.type === 'AssignmentPattern' || value.type === 'ObjectPattern' || value.type === 'ArrayPattern') this.pattern(value);
		else this.expr(value as Expression, 2);
	}

	private prec(e: Expression): number {
		switch (e.type) {
			case 'SequenceExpression':
				return 0;
			case 'ArrowFunctionExpression':
			case 'AssignmentExpression':
			case 'YieldExpression':
				return 2;
			case 'ConditionalExpression':
				return 3;
			case 'BinaryExpression':
			case 'LogicalExpression':
				return PRECEDENCE.get(e.operator)!;
			case 'AwaitExpression':
			case 'UnaryExpression':
				return UNARY;
			case 'UpdateExpression':
				return e.prefix ? UNARY : UNARY + 1;
			case 'ChainExpression':
				return UNARY + 1;
			case 'CallExpression':
			case 'MemberExpression':
			case 'NewExpression':
			case 'TaggedTemplateExpression':
				return MEMBER;
			default:
				return MEMBER + 1;
		}
	}

	/** Prints `e`, in parentheses when it binds looser than `min`. */
	expr(e: Expression | Node, min: number): void {
		if (e.type === 'SpreadElement') return void (this.w('...'), this.expr(e.argument, 2));
		const wrap = this.prec(e as Expression) < min;
		if (wrap) this.w('(');
		this.bare(e as Expression);
		if (wrap) this.w(')');
	}

	private args(list: Node[]) {
		this.w('(');
		this.list(list, a => this.expr(a, 2));
		this.w(')');
	}

	private bare(e: Expression): void {
		switch (e.type) {
			case 'ArrayExpression':
				this.w('[');
				this.list(e.elements, x => this.expr(x, 2));
				if (e.elements.at(-1) === null) this.w(',');
				return this.w(']');
			case 'ArrowFunctionExpression':
			case 'FunctionExpression':
				return this.fn(e as never);
			case 'AssignmentExpression':
				if (e.left.type === 'ObjectPattern' || e.left.type === 'ArrayPattern') this.pattern(e.left);
				else this.expr(e.left, MEMBER);
				this.w(e.operator);
				return this.expr(e.right, 2);
			case 'AwaitExpression':
				this.w('await');
				return this.expr(e.argument, UNARY);
			case 'BinaryExpression':
			case 'LogicalExpression': {
				const p = PRECEDENCE.get(e.operator)!;
				const mixes = (x: Expression) => e.type === 'LogicalExpression' && x.type === 'LogicalExpression' && (e.operator === '??') !== (x.operator === '??');
				const side = (x: Expression, min: number): void => (mixes(x) ? (this.w('('), this.bare(x), this.w(')')) : this.expr(x, min));
				side(e.left as Expression, e.operator === '**' ? UNARY + 1 : p);
				this.w(e.operator);
				return side(e.right, e.operator === '**' ? p : p + 1);
			}
			case 'CallExpression':
				this.expr(e.callee, MEMBER);
				if (e.optional) this.w('?.');
				return this.args(e.arguments);
			case 'ChainExpression':
				return this.bare(e.expression as Expression);
			case 'ConditionalExpression':
				this.expr(e.test, 4);
				this.w('?');
				this.expr(e.consequent, 2);
				this.w(':');
				return this.expr(e.alternate, 2);
			case 'Identifier':
				return this.id(e);
			case 'Literal':
				return this.w(e.raw ?? String(e.value));
			case 'MemberExpression': {
				const integer = e.object.type === 'Literal' && /^\d+$/.test(e.object.raw ?? '');
				if (integer) this.w('(');
				this.expr(e.object, MEMBER);
				if (integer) this.w(')');
				if (e.computed) {
					this.w(e.optional ? '?.[' : '[');
					this.expr(e.property, 0);
					return this.w(']');
				}
				this.w(e.optional ? '?.' : '.');
				return this.w((e.property as { name: string }).name);
			}
			case 'NewExpression': {
				this.w('new');
				/** `new (a())()` and `new (a.b())()` must keep their parentheses. */
				const call = (x: Expression): boolean => x.type === 'CallExpression' || (x.type === 'MemberExpression' && call(x.object as Expression));
				if (call(e.callee as Expression)) (this.w('('), this.bare(e.callee as Expression), this.w(')'));
				else this.expr(e.callee, MEMBER);
				return this.args(e.arguments);
			}
			case 'ObjectExpression':
				this.w('{');
				this.list(e.properties, p => (p.type === 'SpreadElement' ? this.expr(p, 2) : this.property(p as never)));
				return this.w('}');
			case 'SequenceExpression':
				return this.list(e.expressions, x => this.expr(x, 2));
			case 'TaggedTemplateExpression':
				this.expr(e.tag, MEMBER);
				return this.bare(e.quasi as never);
			case 'TemplateLiteral':
				this.w('`');
				e.quasis.forEach((q, i) => {
					this.parts.push(q.value.raw);
					if (i < e.expressions.length) (this.parts.push('${'), this.expr(e.expressions[i]!, 0), this.parts.push('}'));
				});
				return void this.parts.push('`');
			case 'ThisExpression':
				return this.w('this');
			case 'UnaryExpression':
				this.w(e.operator);
				return this.expr(e.argument, UNARY);
			case 'UpdateExpression':
				if (e.prefix) this.w(e.operator);
				this.expr(e.argument, e.prefix ? UNARY : UNARY + 1);
				return e.prefix ? undefined : this.w(e.operator);
			case 'YieldExpression':
				this.w(e.delegate ? 'yield*' : 'yield');
				return e.argument ? this.expr(e.argument, 2) : undefined;
			default:
				throw new Error(`the printer does not support ${e.type}`);
		}
	}
}
