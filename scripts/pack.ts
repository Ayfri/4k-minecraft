/** The deflate stream sits in an `<xmp>` read as windows-1252, CR (the one byte the parser rewrites) is escaped `E1` and `E` itself `E0`. */
import { zopfli } from './lib/zopfli.ts';

/** The bytes the decoder finds by `indexOf` in its lookup string, NUL first then 0x80-0x9F. */
const TABLE = Uint8Array.from({ length: 33 }, (_, i) => (i ? i + 127 : 0));
/** Escape candidates: printable ASCII that is neither a regex/string metacharacter nor the quote of the `onload` attribute. */
const ESCAPES = [...'#%&,:;<=@ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~'].map(c => c.charCodeAt(0));

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
	const settings = [15, 200, 1000].flatMap(numiterations => [0, 15].map(blocksplittingmax => ({ blocksplitting: true, blocksplittingmax, numiterations })));
	const streams = await Promise.all(settings.map(options => zopfli(input, options)));
	settings.forEach((s, i) => out.push([`zopfli-${s.numiterations}-${s.blocksplittingmax}`, streams[i]!]));
	return out.sort((a, b) => a[1].length - b[1].length);
}

/** Escapes CR and the escape byte, or returns undefined when the stream would close the `<xmp>` it sits in. */
export function encode(stream: Uint8Array): { data: Uint8Array; escape: number } | undefined {
	const counts = new Uint32Array(256);
	for (const b of stream) counts[b]!++;
	const escape = ESCAPES.reduce((best, b) => (counts[b]! < counts[best]! ? b : best));
	const out: number[] = [];
	for (const b of stream) b === 13 ? out.push(escape, 49) : b === escape ? out.push(escape, 48) : out.push(b);
	const data = Uint8Array.from(out);
	return /<\/xmp[\t\n\f />]/i.test(Buffer.from(data).toString('latin1')) ? undefined : { data, escape };
}

/** Packs `js` into a self-inflating page: the stream is the text of `<xmp>` (raw text up to EOF) inside `<canvas id=c>`, read back as `c.textContent` once `<body onload>` fires. */
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
		const decoder = `new Response(new Response(Uint8Array.from(c.textContent.replace(/${e}./g,m=>m<"${e}1"?"${e}":"\\r"),c=>(i="\u0000".indexOf(c))<0?c.charCodeAt():i&&i+127)).body.pipeThrough(new DecompressionStream("deflate-raw"))).text().then(eval)`;
		const [before, after] = decoder.split('\u0000') as [string, string];
		const parts = [ascii(`<meta charset=l1><body onload='${before}`), TABLE, ascii(`${after}'><canvas id=c><xmp>`), encoded.data];
		const page = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
		parts.reduce((offset, p) => (page.set(p, offset), offset + p.length), 0);
		return { codec, deflated: stream.length, html: page };
	}
	throw new Error('every compressed candidate closes the xmp, change the input by a byte');
}
