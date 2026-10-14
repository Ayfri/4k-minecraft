struct Uniforms { p: vec3f, t: f32, r: vec2f, a: vec2f, s: f32, h: f32 }
@group(0) @binding(0) var<storage, read_write> W: array<u32>;
@group(0) @binding(1) var<uniform> U: Uniforms;

var<private> C: vec3i;
var<private> N: vec3f;
var<private> K: u32;

const COLORS = array(0u, 0x35c, 0x5a3, 0x864, 0x888, 0xed9, 0x753, 0x373, 0xb85, 0xa43, 0xfff, 0x333, 0xc98, 0x5ee);

/** Seeded hash in [0, 1) of a cell, x and z wrap at the world size and y at its height so everything built on it tiles the world. */
fn H(c: vec3u) -> f32 {
  let p = c & vec3u(MASK, TOP, MASK);
  var h = ((p.x * 0x45d9f3b + p.y) * 0x45d9f3b + p.z) * 0x45d9f3b + u32(U.s);
  h ^= h >> 16;
  h *= 0x45d9f3b;
  return f32(h ^ (h >> 16)) * 2.3e-10;
}

/** Voxel index of a cell, one byte per cell. */
fn I(c: vec3i) -> u32 { return u32(c.x & MASK) | (u32(c.z & MASK) << 9) | (u32(c.y) << 18); }

/** The block at a cell: stone below the world, air above it, x and z wrap. */
fn B(c: vec3i) -> u32 {
  if u32(c.y) > TOP { return select(0u, STONE, c.y < 0); }
  let i = I(c);
  return extractBits(W[i >> 2], (i & 3) * 8, 8);
}

/** Amanatides-Woo march through blocks up to `k`, returns the distance and leaves the hit cell, face and block in C, N and K. */
fn M(o: vec3f, d: vec3f, k: u32, n: i32) -> f32 {
  let s = sign(d);
  let r = 1 / max(abs(d), vec3f(1e-6));
  C = vec3i(floor(o));
  N = vec3f();
  var e = (s * (vec3f(C) - o) + s * .5 + .5) * r;
  for (var i = 0; i < n; i++) {
    K = B(C);
    if K > k { return dot(N, e - r); }
    if C.y > TOP && d.y > 0 { break; }
    N = step(e, min(e.yzx, e.zxy));
    e += N * r;
    C += vec3i(N * s);
  }
  K = 0u;
  return 1e9;
}

@vertex fn v(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  return vec4f(vec2f(vec2u(i & 1, i >> 1)) * 4 - 1, 0, 1);
}

/** The sun direction and the daylight in [0, 1], set once per pixel by the fragment shader. */
var<private> L: vec3f;
var<private> D: f32;

/** Sky gradient without sun or stars, also the colour distant terrain fades to. */
fn S(d: vec3f) -> vec3f {
  return mix(vec3f(.75, .85, 1), vec3f(.25, .5, 1), sqrt(saturate(d.y))) * D + .03;
}

/** Colour of texel `t` (16x16 per face) of block `b` seen from the side `n`, the same tile for every block of a type. */
fn X(b: u32, t: vec2u, n: vec3f) -> vec3f {
  var k = b;
  let q = H(vec3u(t, b));
  var m = 1.1 - .4 * q;
  let a = abs(vec2i(t) * 2 - 15);
  if b == GRASS {
    if n.y < 0 || (n.y == 0 && t.y > u32(H(vec3u(t.x, 7, b)) * 4)) { k = DIRT; }
  } else if b == LOG {
    if n.y == 0 { m *= .7 + .3 * H(vec3u(t.x, 7, b)); } else {
      let r = max(a.x, a.y);
      k = select(PLANKS, b, r > 13);
      m *= 1 - .25 * f32(r / 4 % 2);
    }
  } else if b == LEAVES {
    if q < .3 { m *= .5; }
  } else if b == PLANKS {
    if t.y % 4 == 0 || (t.x + t.y / 4 % 2 * 8) % 16 == 0 { m *= .7; }
  } else if b == BRICKS {
    if t.y % 4 == 0 || (t.x + t.y / 4 % 2 * 4) % 8 == 0 { return vec3f(.7) * m; }
  } else if b == STONE {
    m = .8 + .15 * q + .25 * H(vec3u(t / 2, 9));
  } else if b > SNOW && H(vec3u(t / 2, b)) < .8 { k = STONE; }
  return vec3f((vec3u(COLORS[k]) >> vec3u(8, 4, 0)) & vec3u(15)) / 15 * m;
}

@fragment fn f(@builtin(position) q: vec4f) -> @location(0) vec4f {
  let s = sin(U.a);
  let c = cos(U.a);
  let fw = vec3f(s.x * c.y, s.y, c.x * c.y);
  let r = vec3f(c.x, 0, -s.x);
  let uv = (2 * q.xy - U.r) / U.r.y;
  let d = normalize(fw * 1.4 + r * uv.x + cross(r, fw) * uv.y);
  let w = U.t * .01047 + .3;
  L = normalize(vec3f(cos(w), sin(w), .4));
  D = saturate(L.y * 2 + .4);
  let eyeIn = B(vec3i(floor(U.p))) == WATER;
  var t = M(U.p, d, select(0u, WATER, eyeIn), 256);
  var wd = select(0., t, eyeIn);
  if K == WATER {
    let t0 = t;
    t += M(U.p + d * (t + .01), d, WATER, 128) + .01;
    wd = t - t0;
  }
  var col = S(d) + vec3f(4, 4, 2) * pow(max(dot(d, L), 0), 2000) + step(.985, H(vec3u(d * 200 + 250))) * (1 - D);
  if K > 0 {
    let P = U.p + d * t;
    let n = -N * sign(d);
    var u = vec2u(fract(vec2f(mix(P.x, P.z, N.x), select(P.z, -P.y, N.y == 0))) * 16);
    if n.y > 0 {
      let r = u32(H(vec3u(C.zyx)) * 4);
      if (r & 1) > 0 { u = u.yx; }
      if r > 1 { u.x = 15 - u.x; }
    }
    let e = abs(fract(P) - .5) * (1 - N);
    let ol = f32(I(C)) == U.h && any(e > vec3f(.46));
    let lv = L * sign(L.y);
    let li = vec3f(.1, .12, .22) + vec3f(.65, .5, .3) * saturate(L.y * 5);
    let al = X(K, u, n);
    var ao = 0.;
    let a = C + vec3i(n);
    for (var i = 0; i < 4; i++) {
      let o = a + vec3i(select(n.zxy, n.yzx, i > 1)) * (i % 2 * 2 - 1);
      if B(o) > WATER { ao += 1.5 - distance(P, vec3f(o) + .5); }
    }
    let am = (vec3f(.4, .45, .55) * D + .03) * dot(N, vec3f(.6, 1, .8)) * (1 - ao * .3);
    let sh = max(dot(n, lv), 0) * step(1e9, M(P + n * .01, lv, WATER, 64));
    col = al * (li * sh + am);
    if ol { col = 1 - col; }
    col = mix(col, S(d), smoothstep(40, 120, t));
  }
  col = mix(col, vec3f(.05, .2, .5) * D + .02, 1 - exp(-wd * .3));
  let z = abs(q.xy - U.r / 2);
  let o = sqrt(col);
  return vec4f(select(o, 1 - o, min(z.x, z.y) < 1 && max(z.x, z.y) < 6), 1);
}

/** Value noise with lattice cells of `c` blocks, wrapped so that it tiles the world when `c` divides 512 (and 64 on y). */
fn Q(p: vec3f, c: f32) -> f32 {
  var f = fract(p / c);
  let g = floor(p / c);
  f *= f * (3 - 2 * f);
  var s = 0.;
  for (var i = 0u; i < 8; i++) {
    let o = vec3f(vec3u(i, i / 2, i / 4) % 2);
    let w = mix(1 - f, f, o);
    s += w.x * w.y * w.z * H(vec3u((g + o) * c));
  }
  return s;
}

/** Height of the terrain column at x, z. */
fn T(x: u32, z: u32) -> f32 {
  let p = vec3f(vec3u(x, 0, z));
  let m = pow(Q(p, 256), 4);
  var e = 0.;
  for (var c = 128.; c > 8; c *= .5) { e += Q(p, c) * c / 256; }
  return floor(clamp(SEA + (e - .4) * 90 + m * 35, 2, 60));
}

@compute @workgroup_size(64) fn g(@builtin(global_invocation_id) u: vec3u) {
  let z = u.x >> 7;
  for (var k = 0u; k < 4; k++) {
    let x = (u.x & 127) * 4 + k;
    let h = T(x, z);
    let desert = Q(vec3f(vec3u(x + 64, 0, z + 64)), 128) > .7;
    let t = vec2u(x, z) / 8;
    let r = H(vec3u(t.x, 99, t.y));
    let tx = t.x * 8 + 2 + u32(r * 40) % 4;
    let tz = t.y * 8 + 2 + u32(r * 400) % 4;
    let th = T(tx, tz);
    let tree = r < .3 && th > SHORE && th < 46 && !desert;
    for (var y = 0u; y < 64; y++) {
      let c = vec3u(x, y, z);
      let p = vec3f(c);
      let q = H(c);
      let d = p - vec3f(f32(tx), th + 4, f32(tz));
      var b = 0u;
      if p.y > h {
        if tree && d.x == 0 && d.z == 0 && d.y > -4 && d.y < 1 { b = LOG; }
        else if tree && abs(d.y + .5) < 2 && dot(d, d) < 5.5 - q { b = LEAVES; }
        else if p.y <= SEA { b = WATER; }
      } else {
        let beach = h <= SHORE || desert;
        b = GRASS;
        if h > 52 + q * 6 { b = SNOW; }
        if p.y < h { b = DIRT; }
        if beach { b = SAND; }
        if p.y < h - 3 || y == 0 {
          b = STONE;
          if q < .015 { b = COAL; } else if q < .022 && p.y < 40 { b = IRON; } else if q < .025 && p.y < 12 { b = DIAMOND; }
        }
        if y > 0 && !(beach && p.y > h - 3) && Q(p, 16) > .78 { b = AIR; }
      }
      W[u.x | (y << 16)] |= b << (k * 8);
    }
  }
}
