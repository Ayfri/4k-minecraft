/** The deflate stream sits in an `<xmp>` read as ISO-8859-15 (`l9`, identity except 8 bytes). The parser rewrites CR and NUL and `l9` reads 8 bytes as other characters, so the stream either avoids all 10 byte values (`search`, read as is) or escapes CR (`E1`) and `E` itself (`E0`) and looks the rest up. */
import { cached } from './lib/cache.ts';
import { search, zopfli } from './lib/pool.ts';

/** The bytes a stream must avoid to be read as is: NUL, CR and the 8 bytes `l9` reads as other characters. */
const FORBIDDEN = [0x00, 0x0d, 0xa4, 0xa6, 0xa8, 0xb4, 0xb8, 0xbc, 0xbd, 0xbe];
/** The bytes the escaped decoder finds by `indexOf` in its lookup string: NUL, then 0xA4-0xBE which holds all 8 bytes ISO-8859-15 reads as other characters. */
const TABLE = Uint8Array.from({ length: 28 }, (_, i) => (i ? i + 163 : 0));
/** Escape candidates: every byte that is safe raw inside the `onload` quotes, a regex literal and a string (no NUL, controls, quotes, `\`, `/`, `&` or regex metacharacters). */
const ESCAPES = Array.from({ length: 224 }, (_, i) => i + 32).filter(b => !'"\'\\/&^$.*+?()[]{}|'.includes(String.fromCharCode(b)) && b !== 127);
/** `search` runs this many seeds in parallel (the tests use one), a seed is one deterministic walk and the smallest stream wins. */
const SEEDS = 12;

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

/** True when the stream would close the `<xmp>` it sits in. */
const closesXmp = (stream: Uint8Array) => /<\/xmp[\t\n\f />]/i.test(Buffer.from(stream).toString('latin1'));

/** The smallest stream of `seeds` searches that avoids `FORBIDDEN` and cannot close the `<xmp>`, undefined when none does (inputs of a few bytes). A search takes tens of seconds, so the stream is kept in `.cache` under a hash of the input and of the encoder. */
const searched = (input: Uint8Array, seeds: number) =>
	cached('search', ['lib/deflate.ts'], [input, `${FORBIDDEN}/${seeds}`], async () => {
		const streams = await Promise.all(Array.from({ length: seeds }, (_, seed) => search(input, FORBIDDEN, seed)));
		return streams.filter(s => s && !closesXmp(s)).reduce<Uint8Array | undefined>((a, s) => (!a || s!.length < a.length ? s : a), undefined);
	});

/** Escapes CR and the escape byte, or returns undefined when the stream would close the `<xmp>` it sits in. */
export function encode(stream: Uint8Array): { data: Uint8Array; escape: number } | undefined {
	const counts = new Uint32Array(256);
	for (const b of stream) counts[b]!++;
	const escape = ESCAPES.reduce((best, b) => (counts[b]! < counts[best]! ? b : best));
	const out: number[] = [];
	for (const b of stream) b === 13 ? out.push(escape, 49) : b === escape ? out.push(escape, 48) : out.push(b);
	const data = Uint8Array.from(out);
	return closesXmp(data) ? undefined : { data, escape };
}

/** The page around `data`. With an `escape` byte the decoder unescapes CR and looks up the 8 bytes `l9` changes and NUL, without it the stream avoids all 10 and every character is its byte. */
export function render(data: Uint8Array, escape?: number) {
	const e = escape && String.fromCharCode(escape);
	const decoder = e
		? `new Response(new Response(Uint8Array.from(c.textContent.replace(/${e}./g,m=>"${e}\\r"[m[1]]),c=>(i="\u0000".indexOf(c))<0?c.charCodeAt():i&&i+163)).body.pipeThrough(new DecompressionStream("deflate-raw"))).text().then(eval)`
		: 'new Response(new Response(Uint8Array.from(c.textContent,c=>c.charCodeAt())).body.pipeThrough(new DecompressionStream("deflate-raw"))).text().then(eval)';
	const [before, after] = decoder.split('\u0000') as [string, string?];
	const parts = [ascii(`<meta charset=l9><body onload='${before}`), ...(after === undefined ? [] : [TABLE, ascii(after)]), ascii(`'><canvas id=c><xmp>`), data];
	const page = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	parts.reduce((offset, p) => (page.set(p, offset), offset + p.length), 0);
	return page;
}

/** Packs `js` into a self-inflating page: the stream is the text of `<xmp>` (raw text up to EOF) inside `<canvas id=c>`, read back as `c.textContent` once `<body onload>` fires. The smallest page wins: the `search` stream, or an escaped candidate. */
export async function pack(js: string, seeds = SEEDS): Promise<Packed> {
	const input = new TextEncoder().encode(js);
	const pages: Packed[] = [];
	const [stream, escaped] = await Promise.all([searched(input, seeds), candidates(input)]);
	if (stream) pages.push({ codec: 'search', deflated: stream.length, html: render(stream) });
	for (const [codec, candidate] of escaped) {
		const encoded = encode(candidate);
		if (encoded) pages.push({ codec, deflated: candidate.length, html: render(encoded.data, encoded.escape) });
	}
	if (!pages.length) throw new Error('every compressed candidate closes the xmp, change the input by a byte');
	return pages.reduce((best, p) => (p.html.length < best.html.length ? p : best));
}
