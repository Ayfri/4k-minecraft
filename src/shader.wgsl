struct Uniforms { p: vec3f, t: f32, r: vec2f, a: vec2f, h: vec3f, s: f32 }
@group(0) @binding(0) var<storage, read_write> W: array<u32>;
@group(0) @binding(1) var<uniform> U: Uniforms;

var<private> C: vec3i;
var<private> N: vec3f;
var<private> K: u32;

const COLORS = array(0u, 0x35c, 0x5a3, 0x864, 0x888, 0xed9, 0x753, 0x373, 0xb85, 0xa43, 0xfff, 0x333, 0xc98, 0x5ee);

fn H(p: vec3u) -> f32 {
  var h = ((p.x * 0x45d9f3b + p.y) * 0x45d9f3b + p.z) * 0x45d9f3b + u32(U.s);
  h ^= h >> 16;
  h *= 0x45d9f3b;
  return f32(h ^ (h >> 16)) * 2.3e-10;
}

/** The block at a cell: stone below the world, air above it, x and z wrap. */
fn B(c: vec3i) -> u32 {
  if u32(c.y) > TOP { return select(0u, STONE, c.y < 0); }
  let i = u32(c.x & MASK) | (u32(c.z & MASK) << 9) | (u32(c.y) << 18);
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
  return vec4f(vec2f(f32(i & 1), f32(i >> 1)) * 4 - 1, 0, 1);
}

@fragment fn f(@builtin(position) q: vec4f) -> @location(0) vec4f {
  let fw = vec3f(sin(U.a.x) * cos(U.a.y), sin(U.a.y), cos(U.a.x) * cos(U.a.y));
  let r = vec3f(cos(U.a.x), 0, -sin(U.a.x));
  var uv = (2 * q.xy - U.r) / U.r.y;
  uv.y = -uv.y;
  let d = normalize(fw * 1.4 + r * uv.x + cross(fw, r) * uv.y);
  let t = M(U.p, d, 0, 256);
  let albedo = vec3f((vec3u(COLORS[K]) >> vec3u(8, 4, 0)) & vec3u(15)) / 15 * dot(N, vec3f(.6, 1, .8));
  return vec4f(sqrt(mix(albedo, vec3f(.5, .7, 1), smoothstep(40, 120, t))), 1);
}

/** Value noise with lattice cells of `c` blocks, wrapped so that it tiles the world when `c` divides 512 (and 64 on y). */
fn Q(p: vec3f, c: f32) -> f32 {
  let g = floor(p / c);
  let f = smoothstep(vec3f(), vec3f(1), p / c - g);
  var s = 0.;
  for (var i = 0u; i < 8; i++) {
    let o = vec3f(vec3u(i, i >> 1, i >> 2) & vec3u(1));
    let w = mix(1 - f, f, o);
    s += w.x * w.y * w.z * H(vec3u((g + o) * c) & vec3u(MASK, TOP, MASK));
  }
  return s;
}

/** Height of the terrain column at x, z. */
fn T(x: f32, z: f32) -> f32 {
  var e = 0.;
  for (var c = 128.; c > 8; c *= .5) { e += Q(vec3f(x, 0, z), c) * c / 256; }
  return floor(clamp(SEA + (e - .4) * 90, 2, 60));
}

@compute @workgroup_size(64) fn g(@builtin(global_invocation_id) u: vec3u) {
  let z = u.x >> 7;
  for (var k = 0u; k < 4; k++) {
    let x = (u.x & 127) * 4 + k;
    let h = T(f32(x), f32(z));
    let t = vec2u(x, z) >> vec2u(3);
    let r = H(vec3u(t.x, 99, t.y));
    let tx = t.x * 8 + 2 + u32(r * 40) % 4;
    let tz = t.y * 8 + 2 + u32(r * 400) % 4;
    let th = T(f32(tx), f32(tz));
    let tree = r < .3 && th > SEA + 1 && th < 46;
    for (var y = 0u; y < 64; y++) {
      let p = vec3f(f32(x), f32(y), f32(z));
      let q = H(vec3u(x, y, z));
      let d = p - vec3f(f32(tx), th + 4, f32(tz));
      var b = 0u;
      if p.y > h {
        if tree && d.x == 0 && d.z == 0 && d.y > -4 && d.y < 1 { b = LOG; }
        else if tree && abs(d.y + .5) < 2 && dot(d, d) < 5.5 - q { b = LEAVES; }
        else if p.y <= SEA { b = WATER; }
      } else {
        let beach = h <= SEA + 1;
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
