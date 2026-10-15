/** Builds the dev page and writes `screenshots/<name>.webp` for every view of the README gallery, or only the names given as arguments. */
import { build } from './build.ts';
import { HOUSE_NEAR, overview, runBot } from './bot.ts';
import { GRASS, LAYER, SIZE } from '../src/world.ts';
import { Page } from './webview.ts';

const root = `${import.meta.dir}/..`;

/** Places blocks 5 to 13 on a 3x3 patch of flat grass found within 30 of (x, z) with `bot.place`, after breaking every plant between the camera and the patch, farthest block first so each ray reaches bare ground. */
const blocks = (x: number, z: number, yaw: number) =>
	`(async()=>{const top=bot.top.bind(bot);let cx=${x | 0},cz=${z | 0};
	for(let o=0;o<3600;o++){const px=${x | 0}-30+o%60,pz=${z | 0}-30+(o/60|0);let ok=1;for(let a=-2;a<=2;a++)for(let b=-2;b<=2;b++){const y=top(px+a,pz+b);if(dbg.V[px+a+(pz+b)*${SIZE}+y*${LAYER}]!=${GRASS}||y!=top(px,pz))ok=0}for(let t=3;t<=6;t++)if(top(Math.round(px-Math.sin(${yaw})*t),Math.round(pz-Math.cos(${yaw})*t))!=top(px,pz))ok=0;if(ok){cx=px;cz=pz;break}}
	const sx=cx+.5-Math.sin(${yaw})*4.5,sz=cz+.5-Math.cos(${yaw})*4.5;bot.at(sx,sz,${yaw},-.3);
	const dist=(a,b)=>Math.hypot(a[0]-dbg.P[0],a[1]-dbg.P[2])-Math.hypot(b[0]-dbg.P[0],b[1]-dbg.P[2]);
	const near=[];for(let a=Math.min(sx,cx)-2|0;a<=Math.max(sx,cx)+2;a++)for(let b=Math.min(sz,cz)-2|0;b<=Math.max(sz,cz)+2;b++)near.push([a,b]);
	for(const[a,b]of near.sort(dist)){const y=top(a,b);if(dbg.V[a+b*${SIZE}+(y+1)*${LAYER}])await bot.break(a,y+1,b)}
	const cells=[];for(let i=0;i<9;i++)cells.push([cx-1+i%3,cz-1+(i/3|0),i+${GRASS}]);
	for(const[gx,gz,id]of cells.sort((a,b)=>dist(b,a)))await bot.place(gx,top(gx,gz)+1,gz,id);
	bot.at(sx,sz,${yaw},-.3)})()`;

/** Views as page statements: `bot.at(x, z, yaw, pitch, time)` stands on the ground, `bot.fly(x, y, z, yaw, pitch)` hangs in the air (sun clock: noon 121, sunset 271, night 421). */
const views: { eval: string; name: string }[] = [
	{ eval: 'bot.at(395.5, 525.5, -1.57, .15)', name: 'hero' },
	{ eval: 'bot.fly(380.5, 105, 520.5, -1.57, .05)', name: 'mountains' },
	{ eval: 'bot.at(645.5, 560.5, -1.2, .02, 262)', name: 'sunset' },
	{ eval: 'bot.at(645.5, 560.5, -2.0, .2, 300)', name: 'night' },
	{ eval: blocks(500.5, 660.5, .8), name: 'blocks' },
	{ eval: 'bot.at(480.5, 700.5, 3.14, -.25)', name: 'flowers' },
	{ eval: 'bot.at(520.5, 470.5, 3.14, -.05)', name: 'underwater' },
];

const only = Bun.argv.slice(2);
const wanted = (name: string) => !only.length || only.includes(name);
const write = async (page: Page, name: string) => {
	const png = await page.view.screenshot({ encoding: 'buffer' });
	const size = await Bun.write(`${root}/screenshots/${name}.webp`, await new Bun.Image(png).webp({ quality: 80 }).bytes());
	console.log(`${name} ${(size / 1024).toFixed(0)} KB`);
};

console.log(await build(true));
await using page = await Page.open(`${root}/dist/dev.html`, { height: 900, width: 1600 });
await page.run('new Promise(async r=>{while(typeof bot!="object")await new Promise(s=>setTimeout(s,50));r()})');
for (const { eval: code, name } of views.filter(v => wanted(v.name))) {
	await page.run(code);
	await write(page, name);
}
if (wanted('house')) {
	await page.run('bot.at(434.5, 511.5, 0, 0)');
	const result = await runBot(page, 'house', HOUSE_NEAR);
	if (result.check.missing.length || result.error || result.failures.length) throw new Error(`the house build failed: ${result.error ?? result.failures.join(', ') ?? result.check.missing}`);
	const { pitch, x, y, yaw, z } = overview(result.origin!);
	await page.run(`bot.fly(${x}, ${y}, ${z}, ${yaw}, ${pitch})`);
	await write(page, 'house');
}
