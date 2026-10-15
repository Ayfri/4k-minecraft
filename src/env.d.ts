declare const c: HTMLCanvasElement;
declare const DEV: boolean;
declare module '*.wgsl' {
	const source: string;
	export default source;
}

/** The DEV-only `globalThis.dbg` hooks of `main.ts`. The shader owns the player and the world, `P`, `v`, `V` and `hit` are CPU copies that `sync` refreshes and `act` patches. */
interface Dbg {
	A: [number, number];
	P: import('./world.ts').Vec3;
	/** The CPU copy of the world. */
	V: Uint8Array;
	/** Clicks (0 and 1 break, 2 places the selected block), resolves once the shader applied it and `V` is patched. */
	act(button: number): unknown;
	bench(n?: number): Promise<number>;
	/** Frames synced, the largest gap between the shader feet and the `world.ts` reference physics, and the syncs where the shader and `world.ts` target different cells. */
	readonly drift: { frames: number; hits: number; max: number };
	/** The voxel the view targets and the free cell before it, as of the last `sync`. */
	readonly hit: [number, number] | undefined;
	select(block?: number): number;
	/** Reads the shader state back into `P`, `v` and `hit` (writes a `P` the caller moved), call it after a frame. */
	sync(): Promise<void>;
	time(seconds: number): number;
	v: import('./world.ts').Vec3;
}
declare const dbg: Dbg;
