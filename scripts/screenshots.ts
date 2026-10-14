/** Builds the dev page and writes `screenshots/<name>.webp` for every view of the README gallery, or only the names given as arguments. */
import { build } from './build.ts';
import { Page } from './webview.ts';

const root = `${import.meta.dir}/..`;

/** Statements that stand on the ground of column (x, z) and look along `yaw`, `pitch` with the sun clock at `time` (noon 121, sunset 271, night 421). */
const at = (x: number, z: number, yaw: number, pitch: number, time = 121) =>
	`window.fly=0;let y=63;while(dbg.V[${x | 0}+${z | 0}*512+y*262144]<4)y--;dbg.P.splice(0,3,${x},y+1,${z});dbg.A.splice(0,2,${yaw},${pitch});dbg.time(${time});`;

/** Holds the camera in the air at (x, y, z) on every frame, against gravity, until a later view stands on the ground again. */
const fly = (x: number, y: number, z: number, yaw: number, pitch: number) =>
	`const f=window.fly=Symbol();(function pin(){if(window.fly!==f)return;dbg.P.splice(0,3,${x},${y},${z});dbg.v.fill(0);requestAnimationFrame(pin)})();dbg.A.splice(0,2,${yaw},${pitch});dbg.time(121);`;

/** Places blocks 4 to 12 on a 3x3 patch of flat grass found within 30 of (x, z), after breaking every plant between the camera and the patch, farthest block first so each ray reaches bare ground. */
const blocks = (x: number, z: number, yaw: number) =>
	`window.fly=0;const top=(a,b)=>{let y=63;while(dbg.V[a+b*512+y*262144]<4)y--;return y};let cx=${x | 0},cz=${z | 0};
	for(let o=0;o<3600;o++){const px=${x | 0}-30+o%60,pz=${z | 0}-30+(o/60|0);let ok=1;for(let a=-2;a<=2;a++)for(let b=-2;b<=2;b++){const y=top(px+a,pz+b);if(dbg.V[px+a+(pz+b)*512+y*262144]!=4||y!=top(px,pz))ok=0}for(let t=3;t<=6;t++)if(top(Math.round(px-Math.sin(${yaw})*t),Math.round(pz-Math.cos(${yaw})*t))!=top(px,pz))ok=0;if(ok){cx=px;cz=pz;break}}
	const sx=cx+.5-Math.sin(${yaw})*4.5,sz=cz+.5-Math.cos(${yaw})*4.5;dbg.P.splice(0,3,sx,top(sx|0,sz|0)+1,sz);dbg.time(121);
	const aim=(x,y,z)=>{const d=[x-dbg.P[0],y-dbg.P[1]-1.62,z-dbg.P[2]];dbg.A[0]=Math.atan2(d[0],d[2]);dbg.A[1]=Math.atan2(d[1],Math.hypot(d[0],d[2]))};
	const wait=()=>new Promise(r=>setTimeout(r,120));const dist=(a,b)=>Math.hypot(a[0]-dbg.P[0],a[1]-dbg.P[2])-Math.hypot(b[0]-dbg.P[0],b[1]-dbg.P[2]);
	const near=[];for(let a=Math.min(sx,cx)-2|0;a<=Math.max(sx,cx)+2;a++)for(let b=Math.min(sz,cz)-2|0;b<=Math.max(sz,cz)+2;b++)near.push([a,b]);
	for(const[a,b]of near.sort(dist)){const y=top(a,b);if(dbg.V[a+b*512+(y+1)*262144]){aim(a+.5,y+1.5,b+.5);await wait();dbg.act(0)}}
	const cells=[];for(let i=0;i<9;i++)cells.push([cx-1+i%3,cz-1+(i/3|0),i+4]);
	for(const[gx,gz,id]of cells.sort((a,b)=>dist(b,a))){aim(gx+.5,top(gx,gz)+.9,gz+.5);dbg.select(id);await wait();dbg.act(2)}
	dbg.A.splice(0,2,${yaw},-.3);`;

const views: { name: string; eval: string }[] = [
	{ name: 'hero', eval: at(280.5, 280.5, -2.4, -.25) },
	{ name: 'mountains', eval: fly(190.5, 70, 150.5, -2.3, -.35) },
	{ name: 'sunset', eval: at(280.5, 280.5, -1.2, -.1, 255) },
	{ name: 'night', eval: at(280.5, 280.5, -2.4, .15, 300) },
	{ name: 'blocks', eval: blocks(348.5, 32.5, .8) },
	{ name: 'flowers', eval: at(296.5, 18.5, 3.14, -.25) },
	{ name: 'underwater', eval: at(436.5, 48.5, 3, -.12) },
];

const only = Bun.argv.slice(2);
console.log(await build(true));
await using page = await Page.open(`${root}/dist/dev.html`, { height: 900, width: 1600 });
await Bun.sleep(2500);
for (const { eval: code, name } of views.filter(v => !only.length || only.includes(v.name))) {
	await page.view.evaluate(`(async()=>{${code}})()`);
	await Bun.sleep(600);
	const png = await page.view.screenshot({ encoding: 'buffer' });
	const size = await Bun.write(`${root}/screenshots/${name}.webp`, await new Bun.Image(png).webp({ quality: 80 }).bytes());
	console.log(`${name} ${(size / 1024).toFixed(0)} KB`);
}
