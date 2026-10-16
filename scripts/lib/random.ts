/** A seeded generator (mulberry32) of integers in `[0, 2^32)`, `next() / 2 ** 32` is the float in `[0, 1)`. */
export function mulberry(seed: number) {
	let s = seed;
	return () => {
		let t = (s = (s + 0x6d2b79f5) | 0);
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return (t ^ (t >>> 14)) >>> 0;
	};
}
