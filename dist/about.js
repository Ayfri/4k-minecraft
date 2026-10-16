'use strict';

/** Paints the bytes of the game page (/) on the #bytes canvas, one pixel per byte, and fills the size readouts. */
const SIZE = 64;
const LIMIT = SIZE * SIZE;
const XMP = [...'<xmp>'].map(c => c.charCodeAt(0));
/** Four shades per material, picked by the two low bits of the byte. */
const STONE = ['#6b6b6b', '#767676', '#7d7d7d', '#8a8a8a'];
const GRASS = ['#5d9b3a', '#6aa844', '#79b84f', '#8ac95d'];
const DIRT = ['#6e4429', '#7a4d32', '#8b5a3c', '#996647'];
/** Canvas rows of grass above the ragged edge, which spans the next three rows. */
const GRASS_ROWS = 12;

const rgba = hex => {
	const n = parseInt(hex.slice(1), 16);
	return (255 << 24) | ((n & 255) << 16) | (((n >> 8) & 255) << 8) | (n >> 16);
};
const [stone, grass, dirt] = [STONE, GRASS, DIRT].map(palette => palette.map(rgba));

/** The index just after the first `<xmp>`, where the deflate stream starts. */
const streamStart = bytes => {
	const at = bytes.findIndex((_, i) => XMP.every((c, j) => bytes[i + j] === c));
	return at < 0 ? 0 : at + XMP.length;
};

/** The colour of stream byte `b` at `row`: grass on top, dirt below, and a ragged edge of both in between. */
const earth = (b, row) => {
	const edge = row - GRASS_ROWS;
	const green = edge < 0 || (edge < 3 && (b & 7) < (3 - edge) * 2);
	return (green ? grass : dirt)[b & 3];
};

const set = (id, text) => {
	document.getElementById(id).textContent = text;
};

fetch('/')
	.then(response => (response.ok ? response.arrayBuffer() : Promise.reject(response.status)))
	.then(buffer => {
		const length = buffer.byteLength;
		const bytes = new Uint8Array(buffer).subarray(0, LIMIT);
		const split = streamStart(bytes);
		const free = Math.max(0, LIMIT - length);
		const image = new ImageData(SIZE, SIZE);
		const pixels = new Uint32Array(image.data.buffer);
		bytes.forEach((b, i) => {
			pixels[i] = i < split ? stone[b & 3] : earth(b, (i / SIZE) | 0);
		});
		document.getElementById('bytes').getContext('2d').putImageData(image, 0, 0);
		document.querySelectorAll('[data-bytes]').forEach(el => {
			el.textContent = length;
		});
		set('decoder', `${split} B`);
		set('stream', `${length - split} B`);
		set('free', `${free} B`);
		/** The readout counts up from 0 to --bytes in CSS, `live` swaps its text for the counter. */
		const readout = document.getElementById('readout');
		readout.style.setProperty('--bytes', length);
		readout.classList.add('live');
		/** The free cells at the end of the grid, a block that blinks like a cursor (one row at most). */
		const tail = document.getElementById('tail');
		if (free) {
			tail.style.setProperty('--x', length % SIZE);
			tail.style.setProperty('--y', (length / SIZE) | 0);
			tail.style.setProperty('--free', free);
			tail.hidden = false;
		}
	})
	.catch(() => {});
