/** Results of the slow build stages in `.cache`, one file per key: the hash covers Bun's version, the lockfile, the stage's `sources` (relative to `scripts/`) and its `inputs`, so a hit holds the bytes a fresh run gives. */
const scripts = `${import.meta.dir}/..`;

/** `make()` runs on a miss and its bytes are stored, `undefined` is never stored. */
export async function cached(name: string, sources: string[], inputs: (string | Uint8Array)[], make: () => Promise<Uint8Array | undefined> | Uint8Array | undefined) {
	const hash = new Bun.CryptoHasher('sha256').update(Bun.version).update(await Bun.file(`${scripts}/../bun.lock`).bytes());
	for (const source of sources) hash.update(await Bun.file(`${scripts}/${source}`).bytes());
	for (const input of inputs) hash.update(`${input.length}\0`).update(input);
	const file = Bun.file(`${scripts}/../.cache/${name}-${hash.digest('hex').slice(0, 24)}`);
	if (await file.exists()) return new Uint8Array(await file.arrayBuffer());
	const out = await make();
	if (out) await Bun.write(file, out);
	return out;
}
