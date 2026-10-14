struct Uniforms { p: vec3f, t: f32, r: vec2f, a: vec2f, h: vec3f, s: f32 }
@group(0) @binding(0) var<storage, read_write> W: array<u32>;
@group(0) @binding(1) var<uniform> U: Uniforms;

var<private> C: vec3i;
var<private> N: vec3f;
var<private> K: u32;

const COLORS = array(0u, 0x35c, 0x5a3, 0x864, 0x888, 0xed9, 0x753, 0x373, 0xb85, 0xa43, 0xfff, 0x333, 0xc98, 0x5ee);

fn H(p: vec3u) -> f32 {
  var h = ((p.x * 0x45d9f3b + p.y) * 0x45d9f3b + p.z) * 0x45d9f3b;
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

@compute @workgroup_size(64) fn g(@builtin(global_invocation_id) u: vec3u) {
  for (var y = 0u; y < 64; y++) {
    var w = 0u;
    for (var k = 0u; k < 4; k++) {
      let h = H(vec3u(((u.x & 127) * 4 + k) ^ u32(U.s), y, u.x >> 7));
      w |= select(select(0u, 2 + u32(h * 400) % 8, h < .02), STONE, y < 4) << (k * 8);
    }
    W[u.x | (y << 16)] = w;
  }
}
