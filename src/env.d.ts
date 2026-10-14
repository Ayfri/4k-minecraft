declare const c: HTMLCanvasElement;
declare const DEV: boolean;
declare module '*.wgsl' {
	const source: string;
	export default source;
}

/** The DEV-only `globalThis.dbg` hooks of `main.ts`. */
interface Dbg {
	A: [number, number];
	P: import('./world.ts').Vec3;
	V: Uint8Array;
	act(button: number): unknown;
	bench(n?: number): Promise<number>;
	/** The voxel the view targets and the free cell before it, refreshed every frame. */
	readonly hit: [number, number] | undefined;
	select(block?: number): number;
	time(seconds: number): number;
	v: import('./world.ts').Vec3;
}
declare const dbg: Dbg;
