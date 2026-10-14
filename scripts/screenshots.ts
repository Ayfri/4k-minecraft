/** Builds the dev page and writes `screenshots/<name>.webp` for every view of the README gallery, or only the names given as arguments. */
import { build } from './build.ts';
import { Page } from './webview.ts';

const root = `${import.meta.dir}/..`;

/** Statements that stand on the ground of column (x, z) and look along `yaw`, `pitch` with the sun clock at `time` (noon 121, sunset 271, night 421). */
const at = (x: number, z: number, yaw: number, pitch: number, time = 121) =>
	`window.fly=0;let y=63;while(dbg.V[${x | 0}+${z | 0}*512+y*262144]<3)y--;dbg.P.splice(0,3,${x},y+1,${z});dbg.A.splice(0,2,${yaw},${pitch});dbg.time(${time});`;

/** Holds the camera in the air at (x, y, z) on every frame, against gravity, until a later view stands on the ground again. */
const fly = (x: number, y: number, z: number, yaw: number, pitch: number) =>
	`const f=window.fly=Symbol();(function pin(){if(window.fly!==f)return;dbg.P.splice(0,3,${x},${y},${z});dbg.v.fill(0);requestAnimationFrame(pin)})();dbg.A.splice(0,2,${yaw},${pitch});dbg.time(121);`;

/** Places blocks 3 to 11 on a 3x3 patch of ground centered on (x, z), farthest from the standing point first so each ray reaches bare ground. */
const blocks = (x: number, z: number, yaw: number) =>
	at(x - Math.sin(yaw) * 4.5, z - Math.cos(yaw) * 4.5, yaw, -.3) +
	`const cells=[];for(let i=0;i<9;i++)cells.push([${x | 0}-1+i%3,${z | 0}-1+(i/3|0),i+3]);
	cells.sort((a,b)=>Math.hypot(b[0]-dbg.P[0],b[1]-dbg.P[2])-Math.hypot(a[0]-dbg.P[0],a[1]-dbg.P[2]));
	for(const[gx,gz,id]of cells){let gy=63;while(dbg.V[gx+gz*512+gy*262144]<3)gy--;
	const d=[gx+.5-dbg.P[0],gy+.9-dbg.P[1]-1.62,gz+.5-dbg.P[2]];dbg.A[0]=Math.atan2(d[0],d[2]);dbg.A[1]=Math.atan2(d[1],Math.hypot(d[0],d[2]));
	dbg.select(id);await new Promise(r=>setTimeout(r,100));dbg.act(2)}
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
