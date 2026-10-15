import { expect, test } from 'bun:test';
import { shrink } from './shrink.ts';

/** Runs `js` as a function body with a fake free global `c` and a collector `out`, the minified script must collect the same. */
const run = (js: string) => {
	const out: unknown[] = [];
	new Function('c', 'out', js)({ width: 7 }, out);
	return out;
};
/** The shrunk script collects what the original does, with the rounds of the renamer off to stay fast. */
const same = (js: string) => {
	const small = shrink(js, 0);
	expect(run(small)).toEqual(run(js));
	return small;
};

test('renaming keeps shadowing, shorthand properties and closures apart', () => {
	same(`(()=>{var alpha=3,beta=(gamma,delta)=>{var eps=gamma*delta;return{eps,total:eps+alpha}},{eps:zeta,total}=beta(2,5);out.push(zeta,total,c.width);var f=function(x,y){return[x,y,alpha,(()=>{var alpha=9;return alpha+x})()]};out.push(...f(1,2));for(let i=0;i<2;i++){let j=i*4;out.push(j+total)}})()`);
});

test('a shader string is renamed with the script and the script still runs', () => {
	const src = 'fn first(arg:f32)->f32{var tmp=arg*2.;return tmp;}fn second(arg:f32)->f32{return first(arg)+first(arg);}';
	const js = '(()=>{var longName=5,shaderText=' + JSON.stringify(src) + ';out.push(longName,shaderText.length)})()';
	const small = shrink(js, 1, undefined, { rounds: 100, seed: 3, src });
	expect(small).not.toContain(src);
	expect(small).toMatch(/fn \w+\(\w:f32\)->f32/);
	expect(run(small)[0]).toBe(5);
});

test('renaming never takes the name of a free variable the scope reads', () => {
	const small = same('(()=>{var longa=1,longb=c.width;out.push(longa+longb)})()');
	expect(small).toMatch(/c\.width/);
});

test('constants fold and inline, strings move to their only read, dead bindings and literal ifs go', () => {
	const small = same('(()=>{var SIZE=1024,MASK=SIZE-1,LAYER=SIZE*SIZE,text="hi",unused=5,n=3;if(false){out.push("never")}if(true)out.push(MASK,LAYER);out.push(text,n*2)})()');
	expect(small).not.toContain('never');
	expect(small).toContain('1048576');
	expect(small).not.toContain('unused');
});

test('a variable that is written again is not a constant', () => {
	same('(()=>{var n=1;out.push(n);n=2;out.push(n)})()');
});

test('calls of expression-body functions become their body, with literal or name arguments', () => {
	const small = same('(()=>{var keys={w:1},key=code=>+!!keys[code],twice=(a,b)=>a*b+a,x=4;out.push(key("w")-key("s"),twice(x,3),twice(2,x))})()');
	expect(small).not.toMatch(/key|twice/);
	expect(small).toContain('16,10');
});

test('a function with an impure argument keeps its call, once-read functions move to their read', () => {
	same('(()=>{var n=0,next=()=>++n,twice=a=>a+a,run=f=>f(),once=()=>out.push("once");out.push(twice(next()));run(once)})()');
});

test('let and const become var unless a closure in a loop could tell', () => {
	const small = same('(()=>{const k=2;let fns=[];for(let i=0;i<3;i++)fns.push(()=>i*k);out.push(...fns.map(f=>f()));for(const v of [1,2]){let t;out.push(t);t=v}})()');
	expect(small).toContain('let');
});

test('guards, destructuring, sequences and returns', () => {
	same('(()=>{var o={q:5},s=0;({q:s}=o);var f=e=>{if(!e)return;out.push(e);out.push(e+1)};f(0);f(2);var g=()=>{out.push(s);return s+1};out.push(g());for(var i=0;i<2;i++);out.push(i);var h=n=>{out.push(n);if(n)return 1;return 2};out.push(h(0),h(1))})()');
});

test('the printer keeps parentheses, `else` binding and statement starts', () => {
	same(`(()=>{var a=2,b=3,d=4,o={x:1};out.push((a+b)*d,a-(b-d),a-(-b),-(-a),(a,b),a**b**2,(-a)**2,(a??b)||d,a&&(b||d),typeof(a+b),new(function(){return Object})()(),void 0);if(a)if(b)out.push(1);else out.push(2);if(a){if(b)out.push(3)}else out.push(4);(function(){out.push(5)})();({}).x;[a].map(x=>({x}));out.push(a in o,a+ +b,a- -b,a+ ++b,1..toString(),(1).x,o?.x,o?.["x"]?.y,\`t\${a}u\`)})()`);
});

test('loops, labels, switch and try print back', () => {
	same('(()=>{a:for(var i=0;i<3;i++){for(var j=0;j<3;j++){if(j==1)continue a;if(i==2)break a;out.push(i,j)}}switch(out.length){case 1:out.push("one");break;default:out.push("d")}try{throw 1}catch(e){out.push(e)}finally{out.push("f")}var k=0;do k++;while(k<3);while(k--)out.push(k);for(var p in{a:1})out.push(p)})()');
});

test('async, spread, getters and optional calls', () => {
	same('(()=>{var o={get v(){return 1},m(a){return a}},f=async x=>x;out.push(o.v,o.m(2),...[3,4],o.n?.(),typeof f);var[p,,q=5]=[1,2];var{r,s:t=6}={r:7};out.push(p,q,r,t)})()');
});
