struct Uniforms { p: vec3f, t: f32, a: vec3f, h: f32, r: vec2f }
@group(0) @binding(0) var<storage, read_write> W: array<u32>;
@group(0) @binding(1) var<uniform> U: Uniforms;

var<private> C: vec3i;
var<private> N: vec3f;
var<private> K: u32;

const COLORS = array(0u, 0x4c22, 0x4563, 0x4ec4, 0x3563, 0x5864, 0x2777, 0x1dca, 0x2653, 0x8462, 0x2a85, 0x3954, 0xfff, 0x6333, 0x4a87, 0x46bb);

/** Seeded hash in [0, 1) of a cell, x and z wrap at the world size and y at its height so everything built on it tiles the world. */
fn H(c: vec3u) -> f32 {
  let p = c & vec3u(MASK, TOP, MASK);
  var h = ((p.x * 0x45d9f3b + p.y) * 0x45d9f3b + p.z) * 0x45d9f3b + 1;
  h ^= h >> 16;
  h *= 0x45d9f3b;
  return f32(h ^ (h >> 16)) * 2.3e-10;
}

/** Voxel index of a cell, one byte per cell. */
fn I(c: vec3i) -> u32 { return dot(vec3u(c) & vec3u(MASK, TOP, MASK), vec3u(1, 1 << 18, 512)); }

/** The block at a cell: stone below the world, air above it, x and z wrap. */
fn B(c: vec3i) -> u32 {
  if u32(c.y) > TOP { return u32(c.y < 0) * STONE; }
  let i = I(c);
  return (W[i >> 2] >> (i % 4 * 8)) & 255;
}

/** Texel (16x16 per face) of the point `P` on the face N of its cell. */
fn A(P: vec3f) -> vec2u {
  return vec2u(fract(vec2f(mix(P.x, P.z, N.x), select(P.z, -P.y, N.y == 0))) * 16);
}

/** Colour index of the plant texel `u` of the cell C: blades for a tuft, a stem and a red or yellow head for a flower, 0 where transparent (the top face always is). */
fn F(u: vec2u) -> u32 {
  let a = abs(i32(u.x) * 2 - 15);
  if N.y == 0 {
    if K == TUFT { return K * u32(u.y > 1 + u32(H(vec3u(u.x, 3, 3)) * 10)); }
    if a < 2 && u.y > 9 { return GRASS; }
    if a + abs(i32(u.y) - 7) * 2 < 7 { return 1 + u32(H(vec3u(C.zyx)) * 2) * 2; }
  }
  return 0;
}

/** Amanatides-Woo march past blocks up to `k`, returns the distance and leaves cell, face and block in C, N, K (flowers: opaque texels). */
fn M(o: vec3f, d: vec3f, k: u32, n: i32) -> f32 {
  let s = sign(d);
  let r = 1 / (abs(d) + 1e-6);
  C = vec3i(floor(o));
  N = vec3f();
  var e = (s * (vec3f(C) - o + .5) + .5) * r;
  for (var i = 0; i < n; i++) {
    K = B(C);
    let t = dot(N, e - r);
    if K > k && (K > TUFT || F(A(o + d * t)) > 0) { return t; }
    if C.y > TOP && d.y > 0 { break; }
    N = step(e, min(e.yzx, e.zxy));
    e += N * r;
    C += vec3i(N * s);
  }
  K = 0;
  return 1e9;
}

@vertex fn v(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  return vec4f(vec2f(vec2u(i & 1, i >> 1)) * 4 - 1, 0, 1);
}

/** Colour of texel `t` (16x16 per face) of block `b` seen from the side `n`, the same tile for every block of a type. */
fn X(b: u32, t: vec2u, n: vec3f) -> vec3f {
  var k = b;
  var q = H(vec3u(t, b));
  var m = 1.;
  if b == GRASS {
    if n.y < 0 || (n.y == 0 && t.y > u32(H(vec3u(t.x, 7, b)) * 4)) { k = DIRT; }
  } else if b == LOG {
    if n.y == 0 { m = .7 + .6 * H(vec3u(t.x, t.y / 5, b)); } else {
      let a = abs(vec2i(t) * 2 - 15);
      let r = max(a.x, a.y);
      k = select(PLANKS, b, r > 13);
      m = 1 - .25 * f32(r / 4 % 2);
    }
  } else if b == PLANKS {
    if t.y % 4 > 2 { m = .65; }
  } else if b == BRICKS {
    if t.y % 4 > 2 || (t.x + t.y / 4 % 2 * 4) % 8 == 3 { k = STONE; }
  } else if b < WATER {
    k = F(t);
  } else if b > SNOW && H(vec3u(t / 2, b)) < .8 { k = STONE; }
  let e = COLORS[k];
  let c = vec3f(vec3u(e >> 8, e >> 4, e) % 16) / 15 * (m + (q - .5) * f32(e >> 12) / 8);
  return c * c;
}

@fragment fn f(@builtin(position) q: vec4f) -> @location(0) vec4f {
  let fw = U.a;
  let r = normalize(vec3f(fw.z, 0, -fw.x));
  let uv = (2 * q.xy - U.r) / U.r.y;
  let d = normalize(fw * 1.4 + r * uv.x + cross(r, fw) * uv.y);
  let w = U.t * .01047 + .3;
  let L = normalize(vec3f(cos(w), sin(w), .4));
  let D = saturate(L.y * 2 + .4);
  /** Sky gradient without sun or stars, also the colour distant terrain fades to. */
  let sky = mix(vec3f(.75, .85, 1), vec3f(.25, .5, 1), sqrt(saturate(d.y))) * D + .03;
  let eyeIn = B(vec3i(floor(U.p))) == WATER;
  var t = M(U.p, d, u32(eyeIn) * WATER, 256);
  var wd = f32(eyeIn) * t;
  if K == WATER {
    wd = M(U.p + d * (t + .01), d, WATER, 128) + .01;
    t += wd;
  }
  var col = sky + vec3f(4, 4, 2) * pow(max(dot(d, L), 0), 2000) + step(.985, H(vec3u(d * 200 + 250))) * (1 - D);
  if K > 0 {
    let P = U.p + d * t;
    let n = -N * sign(d);
    var u = A(P);
    if n.y > 0 {
      let r = u32(H(vec3u(C.zyx)) * 4);
      if r % 2 > 0 { u = u.yx; }
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
    if ol { col = abs(1 - col); }
    col = mix(col, sky, smoothstep(40, 120, t));
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
  _ = U.h;
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
    var below = 0u;
    for (var y = 0u; y < 64; y++) {
      let c = vec3u(x, y, z);
      let p = vec3f(c);
      let q = H(c);
      let d = p - vec3f(f32(tx), th + 4, f32(tz));
      var b = 0u;
      if p.y > h {
        if tree && d.x == 0 && d.z == 0 && d.y > -4 && d.y < 1 { b = LOG; }
        else if tree && abs(d.y + .5) < 2 && dot(d, d) < 5.5 - q { b = LEAVES; }
        else if below == GRASS && q < .3 { b = 1 + u32(q > .05); }
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
      below = b;
      W[u.x | (y << 16)] |= b << (k * 8);
    }
  }
}
