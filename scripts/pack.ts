/**
 * Self-extracting HTML packer. The page is decoded as windows-1252 (`<meta charset=l1>`), so the raw deflate stream sits
 * in an HTML comment and every byte reads back as one character: NUL becomes U+FFFD and 0x80-0x9F become the 1252
 * punctuation, both undone through a lookup string. CR is the only byte the parser loses (normalized to LF), it is
 * escaped as `E1` and the escape byte itself as `E0`, with `E` the rarest safe byte of the stream.
 */
import { deflateAsync } from '@gfx/zopfli';

/** The bytes the decoder finds by `indexOf` in its lookup string, NUL first then 0x80-0x9F. */
const TABLE = Uint8Array.from({ length: 33 }, (_, i) => (i ? i + 127 : 0));
/** Escape candidates: printable ASCII that is neither a regex/string metacharacter nor part of `-->`. */
const ESCAPES = [...'#%&\',:;<=@ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~'].map(c => c.charCodeAt(0));

export interface Packed {
	codec: string;
	deflated: number;
	html: Uint8Array;
}

const ascii = (s: string) => Uint8Array.from(s, c => c.charCodeAt(0));

export async function candidates(input: Uint8Array<ArrayBuffer>): Promise<[string, Uint8Array][]> {
	const out: [string, Uint8Array][] = [
		['zlib-9', Bun.deflateSync(input, { level: 9 })],
		['libdeflate-12', Bun.deflateSync(input, { level: 12, library: 'libdeflate' })],
	];
	for (const numiterations of [15, 200, 1000])
		for (const blocksplittingmax of [0, 15])
			out.push([`zopfli-${numiterations}-${blocksplittingmax}`, await deflateAsync(input, { blocksplitting: true, blocksplittingmax, numiterations })]);
	return out.sort((a, b) => a[1].length - b[1].length);
}

/** Escapes CR and the escape byte, or returns undefined when the stream would break the comment it sits in. */
export function encode(stream: Uint8Array): { data: Uint8Array; escape: number } | undefined {
	const counts = new Uint32Array(256);
	for (const b of stream) counts[b]!++;
	const escape = ESCAPES.reduce((best, b) => (counts[b]! < counts[best]! ? b : best));
	const out: number[] = [];
	for (const b of stream) b === 13 ? out.push(escape, 49) : b === escape ? out.push(escape, 48) : out.push(b);
	const data = Uint8Array.from(out);
	const text = Buffer.from(data).toString('latin1');
	return text.includes('--') || /^-?>|-$/.test(text) ? undefined : { data, escape };
}

/**
 * Packs `js` into a page that inflates and evaluates it. The comment and the decoder sit inside `<canvas id=c>` as
 * fallback content, which never renders, so the decoder reads its payload as `c.firstChild` and the game gets `c`.
 */
export async function pack(js: string): Promise<Packed> {
	const input = new TextEncoder().encode(js);
	let best: { codec: string; encoded: NonNullable<ReturnType<typeof encode>>; stream: Uint8Array } | undefined;
	for (const [codec, stream] of await candidates(input)) {
		const encoded = encode(stream);
		if (encoded && (!best || encoded.data.length < best.encoded.data.length)) best = { codec, encoded, stream };
	}
	if (best) {
		const { codec, encoded, stream } = best;
		const e = String.fromCharCode(encoded.escape);
		const decoder = `new Response(new Response(Uint8Array.from(c.firstChild.data.replace(/${e}./g,m=>m<"${e}1"?"${e}":"\\r"),c=>(i="\u0000".indexOf(c))<0?c.charCodeAt():i&&i+127)).body.pipeThrough(new DecompressionStream("deflate-raw"))).text().then(eval)`;
		const [before, after] = decoder.split('\u0000') as [string, string];
		const parts = [ascii(`<meta charset=l1><canvas id=c><!--`), encoded.data, ascii(`--><script>${before}`), TABLE, ascii(`${after}</script>`)];
		const page = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
		parts.reduce((offset, p) => (page.set(p, offset), offset + p.length), 0);
		return { codec, deflated: stream.length, html: page };
	}
	throw new Error('every compressed candidate breaks the HTML comment, change the input by a byte');
}

if (import.meta.main) {
	const [input, output] = Bun.argv.slice(2);
	if (!input || !output) throw new Error('usage: bun scripts/pack.ts <in.js> <out.html>');
	const packed = await pack(await Bun.file(input).text());
	await Bun.write(output, packed.html);
	console.log(`${packed.codec}: deflate ${packed.deflated} B, page ${packed.html.length} B, ${4096 - packed.html.length} B left`);
}
