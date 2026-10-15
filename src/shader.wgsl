/** The immediates: view angles, canvas size (0 while the world generates), input (forward, 1.3 while sprinting, right, jump, click: -1 break, block id to place, 0 none), time and frame time in seconds, the selected block (drawn as a preview in the bottom-right corner). */
struct Uniforms { a: vec2f, r: vec2f, k: vec4f, t: f32, d: f32, s: f32 }
@group(0) @binding(0) var<storage, read_write> W: array<u32>;
/** The canvas texture, written by the render branch of `g`. */
@group(0) @binding(1) var Z: texture_storage_2d<rgba8unorm, write>;
/** The player state: feet and vertical speed, then the targeted cell (-9 for none) and the contact (2 when the feet landed, 1 against a wall). */
@group(0) @binding(2) var<storage, read_write> S: array<vec4f, 2>;
var<immediate> U: Uniforms;

/** The eye above the feet. */
const HEAD = vec3f(0, 1.62, 0);
var<private> C: vec3i;
var<private> N: vec3f;
var<private> K: u32;
/** Whether `M` stopped on the outline band of the targeted cell. */
var<private> O: bool;

const COLORS = array(0u, 0x4c22, 0x4573, 0x4ec4, 0x3573, 0x5864, 0x2777, 0x1edb, 0x6753, 0x8351, 0x1a85, 0x0b65, 0x0def, 0x1ade, 0x6333, 0x4a87, 0x46bb, 0xc555);

/** Seeded hash in [0, 1) of a cell, x and z wrap at the world size and y at its height so everything built on it tiles the world. */
fn H(c: vec3u) -> f32 {
  let p = c & vec3u(MASK, TOP, MASK);
  var h = ((p.x * 73244475 + p.y) * 73244475 + p.z) * 73244475 + 1;
  h ^= h >> 16;
  h *= 73244475;
  return f32(h ^ (h >> 16)) * 2.3e-10;
}

/** Voxel index of a cell, one byte per cell. */
fn I(c: vec3i) -> u32 { return dot(vec3u(c) & vec3u(MASK, TOP, MASK), vec3u(1, LAYER, SIZE)); }

/** The block at a cell: air above the world, x and z wrap. Nothing reads below it, the bedrock floor cannot be broken. */
fn B(c: vec3i) -> u32 {
  if c.y > TOP { return 0; }
  let i = I(c);
  return (W[i >> 2] >> (i % 4 * 8)) & 255;
}

/** Sets the block of a cell inside the world unless it is bedrock, one invocation edits so no atomics are needed. */
fn edit(c: vec3i, b: u32) {
  if u32(c.y) > TOP || B(c) == BEDROCK { return; }
  let i = I(c);
  let s = i % 4 * 8;
  W[i >> 2] = (W[i >> 2] & ~(255u << s)) | (b << s);
}

/** View direction from the yaw and pitch. */
fn look() -> vec3f {
  let s = sin(U.a);
  let c = cos(U.a);
  return vec3f(s.x * c.y, s.y, c.x * c.y);
}

/** Texel (16x16 per face) of the point `P` on the face N of its cell. */
fn A(P: vec3f) -> vec2u {
  return vec2u(fract(vec2f(mix(P.x, P.z, N.x), select(P.z, -P.y, N.y < 1))) * 16);
}

/** Colour index of the plant texel `u` of the cell C: blades for a tuft, a stem and a red or yellow head for a flower, 0 where transparent (plants only reach it through the diagonal planes of `M`). Leaves have holes, glass keeps its frame and a streak. */
fn F(u: vec2u) -> u32 {
  if K == GLASS { return u32(any(u % 15 == vec2u()) || (u.x + u.y == 6 && u.x - 2 < 3)); }
  if K > TUFT { return u32(K != LEAVES || H(vec3u(u, K)) > .3); }
  let a = abs(i32(u.x) * 2 - 15);
  if K == TUFT {
    let w = i32(u.x) + i32(u.y) * (i32(H(vec3u(u.x / 4, 5, 3)) * 3) - 1) / 6;
    let h = 1 + u32(a * a / 40) + u32(H(vec3u(u32(w), 3, 3)) * 5);
    return K * u32(select(u.y > 11 + u32(a / 5), u.y > h, (w & 1) > 0));
  }
  let d = i32(u.x) - 7;
  if (d == 0 && u.y > 9) || (i32(u.y) + abs(d) == 14 && abs(d) < 3) { return LEAVES; }
  if d == 0 && u.y == 7 { return COAL; }
  if a + abs(i32(u.y) - 7) * 2 < 7 { return 1 + u32(H(vec3u(C.zyx)) * 2) * 2; }
  return 0;
}

/** Amanatides-Woo march past blocks up to `k`, returns the distance and leaves cell, face and block in C, N, K. Leaves and glass stop on opaque face texels, plants on the opaque texels of the two diagonal planes `x = z` and `x + z = 1` of their cell (N is then +x), any block on the outline band of the targeted cell, both skipped in the start cell (no entry face there, a shadow ray leaving a face under glass would read its frame row or outline). Under 99 steps it is the targeting march and stops on any whole cell that is neither air nor water. */
fn M(o: vec3f, d: vec3f, k: u32, n: i32) -> f32 {
  let s = sign(d);
  let r = 1 / (abs(d) + 1e-6);
  C = vec3i(floor(o));
  N = vec3f();
  var e = (s * (vec3f(C) - o + .5) + .5) * r;
  for (var i = 0; i < n; i++) {
    K = B(C);
    let t = dot(N, e - r);
    let P = o + d * t;
    if n < 99 && min(K, K ^ WATER) > 0 { return t; }
    if K > k {
      O = all(C == vec3i(S[1].xyz)) && any(abs(fract(P) - .5) * (1 - N) > vec3f(.49));
      if i > 0 && ((K > TUFT && F(A(P)) > 0) || O) { return t; }
      if K < WATER {
        let p = P - vec3f(C);
        var b = 1e9;
        N = vec3f(1, 0, 0);
        for (var j = -1.; j < 2; j += 2) {
          let h = ((j + 1) / 2 - p.x - j * p.z) / (d.x + j * d.z);
          let Q = p + d * h;
          if h > 0 && all(Q == fract(Q)) && F(A(Q)) > 0 { b = min(b, h); }
        }
        if b < 1e9 { return t + b; }
      }
    }
    if C.y > TOP && d.y > 0 { break; }
    N = step(e, min(e.yzx, e.zxy));
    e += N * r;
    C += vec3i(N * s);
  }
  K = 0;
  return 1e9;
}

/** Colour of texel `t` (16x16 per face) of block `b` seen from the side `n`, the same tile for every block of a type. */
fn X(b: u32, t: vec2u, n: vec3f) -> vec3f {
  var m = 1.;
  var k = b;
  var s = t;
  if b == GRASS {
    if n.y < 0 || (n.y == 0 && t.y > 1 + u32(H(vec3u(t.x, 7, b)) * 3)) { k = DIRT; }
  } else if b == LOG {
    if n.y == 0 { s.y = (t.y + t.x * 5) / (4 + t.x % 2); } else {
      let a = abs(vec2i(t) * 2 - 15);
      let r = max(a.x, a.y);
      k = select(PLANKS, b, r > 14);
      m = 1 - .2 * f32(r / 2 % 2);
    }
  } else if b == PLANKS {
    if t.y % 4 > 2 { m = .72; } else if (t.x + t.y / 4 % 2 * 8) % 16 == 3 { m = .88; }
  } else if b == BRICKS {
    if t.y % 4 > 2 || (t.x + t.y / 4 % 2 * 4 + 4) % 8 > 6 { k = STONE; m = 1.3; } else { m = 1.15 - .1 * f32(t.y % 4); }
  } else if b == SAND {
    m = 1 + .12 * step(.95, H(vec3u(t, b)));
  } else if b < WATER {
    k = F(t);
  } else if b > GLASS && b < BEDROCK {
    let a = abs(vec2i(t) * 2 - 15);
    let r = max(a.x, a.y);
    let o = Q(vec3f(vec3u(t, b + 2)) * vec3f(.7, 1, 1), 1.7);
    if f32(r) / 90 + .5 > o || r > 11 { k = STONE; } else if o > .6 { m = 1.3; }
  }
  if k == DIRT && H(vec3u(t, b)) > .985 { k = STONE; }
  if k == STONE || b == BEDROCK { s.x = (t.x + t.y * 5) / (2 + t.y % 2 * u32(b < BEDROCK)); } else if b == LEAVES { s /= 2; }
  let e = COLORS[k];
  let c = vec3f(vec3u(e >> 8, e >> 4, e) % 16) / 15 * (m + (H(vec3u(s, b)) - .5) * f32(e >> 12) / 8) * vec3f(1 + .04 * f32(k == DIRT), 1, 1);
  return c * c;
}

/** Colour of the pixel whose corner is at `q` from the canvas centre (y down), so the crosshair arms are 1 px wide on an even canvas size and 2 px on an odd one. */
fn f(q: vec2f) -> vec4f {
  let fw = look();
  let eye = S[0].xyz + HEAD;
  let r = normalize(vec3f(fw.z, 0, -fw.x));
  let uv = 2 * q / U.r.y;
  let d = normalize(fw * 1.4 + r * uv.x + cross(r, fw) * uv.y);
  let w = U.t * .01047 + .3;
  let L = normalize(vec3f(cos(w), sin(w), .4));
  let D = saturate(L.y * 2 + .4);
  /** Sky gradient without sun or stars, also the colour distant terrain fades to. */
  let sky = mix(vec3f(.75, .85, 1), vec3f(.25, .5, 1), sqrt(saturate(d.y))) * D + .002;
  let eyeIn = B(vec3i(floor(eye))) == WATER;
  var t = M(eye, d, u32(eyeIn) * WATER, 384);
  var wd = f32(eyeIn) * t;
  /** Fog distance: to the water surface for water pixels, 0 under water where only the water tint applies. */
  let s = t - wd;
  if K == WATER {
    wd = M(eye + d * (t + .01), d, WATER, 128) + .01;
    t += wd;
  }
  var col = sky + vec3f(4, 4, 2) * pow(max(dot(d, L), 0), 2000) + (1 - D) * step(.985, H(vec3u(d * 200 + 250)));
  if K > 0 {
    let P = eye + d * t;
    /** Plants are lit as an upward face, their +x plane normal would flip with the side they are seen from. */
    let n = select(-N * sign(d), vec3f(0, 1, 0), K < WATER);
    var u = A(P);
    if n.y > 0 && K > WATER {
      let r = u32(H(vec3u(C.zyx)) * 4);
      if r % 2 > 0 { u = u.yx; }
      if r > 1 { u.x = 15 - u.x; }
    }
    let ol = O;
    /** Minecraft-like smooth AO over sun and sky light: the 8 cells around the front cell of the face weighted by distance, squared because the output is `sqrt(col)`, about .6 on screen along an edge and .4 in an inner corner. Glass neither casts nor receives it. */
    var a = 1.;
    for (var i = 0; i < 9; i++) {
      let o = C + vec3i(n + n.zxy * f32(i % 3 - 1) + n.yzx * f32(i / 3 - 1));
      let b = B(o);
      if i != 4 && b > WATER && b != GLASS && K != GLASS { a -= saturate(1.5 - distance(P, vec3f(o) + .5)) * .3; }
    }
    col = X(K, u, n) * ((vec3f(.4, .45, .55) * D + .03) * dot(N, vec3f(.6, 1, .8)) + vec3f(.65, .5, .3) * saturate(L.y * 5) * max(dot(n, L), 0) * step(1e9, M(P + n * .01, L, WATER, 128))) * a * a;
    if ol { col = vec3f(1); }
  }
  col = mix(col, vec3f(.05, .2, .5) * D + .003, 1 - exp(-wd * .2));
  if s < 1e9 { col = mix(col, sky, smoothstep(80, 200, s)); }
  /** Preview of the selected block, texels scaled 3x in a 48 px square 10 px from the bottom-right corner, with the transparent texels of plants, leaves and glass left out as in the world. */
  let v = vec2u(vec2i(q - U.r / 2 + 58)) / 3;
  if (v.x | v.y) < 16 {
    K = u32(U.s);
    C = vec3i();
    if F(v) > 0 { col = X(K, v, vec3f()); }
  }
  let z = abs(q);
  let o = sqrt(col);
  return vec4f(select(o, 1 - o, min(z.x, z.y) < 1 && max(z.x, z.y) < 9), 1);
}

/** Value noise with lattice cells of `c` blocks, wrapped so that it tiles the world when `c` divides 1024 (and 128 on y). */
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
fn T(c: vec2u) -> f32 {
  let p = vec3f(vec3u(c, 0).xzy);
  let m = pow(Q(p + vec3f(844, 0, 0), 512), 3);
  var e = 0.;
  for (var c = 256.; c > 8; c *= .5) { e += Q(p, c) * c / 512; }
  return floor(clamp(SEA + (e - .45) * (50 + m * 300) + m * (130 + abs(Q(p, 64) - .5) * 300), 2, 124));
}

/** Whether the 0.6 x 1.8 box standing on the feet position `p` overlaps a solid cell, sampled 0.9 apart on y so no cell is skipped. */
fn hits(p: vec3f) -> bool {
  for (var i = 0; i < 12; i++) {
    if B(vec3i(floor(p + vec3f(f32(i & 1) * .6 - .3, f32(i % 3) * .9, f32(i / 6) * .6 - .3)))) > WATER { return true; }
  }
  return false;
}

/** One frame of the player: walk, swim, jump and fall with a per-axis collision (the contact is 2 when the feet landed, 1 against a wall), then the targeting march (reach 6) and the click of the frame. */
fn tick() {
  var p = S[0].xyz;
  let vy = S[0].w;
  var contact = S[1].w;
  let w = B(vec3i(floor(p))) == WATER;
  let d = look();
  let a = normalize(d.xz);
  let j = U.k.z > 0;
  let m = (U.k.x * a + U.k.y * vec2f(a.y, -a.x)) * select(4.3, 1.7, w);
  let l = select(select(max(vy - 28 * U.d, -30), 8.5, j && contact > 1), select(max(vy - 8.4 * U.d, -2), select(3., 8.5, contact > 0), j), w);
  var v = vec3f(m.x, l, m.y);
  contact = 0;
  for (var i = 0; i < 3; i++) {
    p[i] += v[i] * U.d;
    if hits(p) {
      if i == 1 && v.y < 0 {
        p.y = ceil(p.y);
        contact = 2;
      } else {
        p[i] -= v[i] * U.d;
        contact = max(contact, f32(~i & 1));
      }
      v[i] = 0;
    }
  }
  S[0] = vec4f(p, v.y);
  let t = M(p + HEAD, d, WATER, 16);
  S[1] = vec4f(select(vec3f(-9), vec3f(C), t < 6), contact);
  let b = i32(U.k.w);
  if t >= 6 || b == 0 { return; }
  let u = C + vec3i(0, 1, 0);
  if b < 0 {
    edit(C, 0);
    if B(u) < WATER { edit(u, 0); }
    return;
  }
  let c = select(C - vec3i(N * sign(d)), C, K < WATER);
  let o = B(c);
  if o <= WATER {
    edit(c, u32(b));
    if hits(p) { edit(c, o); }
  }
}

/** Draws pixel `u.xy` once the canvas size is set, else generates the 4 columns of world word `u.x`, or steps the player in a lone workgroup. */
@compute @workgroup_size(64) fn g(@builtin(global_invocation_id) u: vec3u, @builtin(num_workgroups) n: vec3u) {
  if n.x < 2 {
    if u.x < 1 { tick(); }
    return;
  }
  if U.r.x > 0 {
    textureStore(Z, u.xy, f(vec2f(u.xy) - U.r / 2));
    return;
  }
  for (var k = 0u; k < 4; k++) {
    let e = vec2u(u.x % 256 * 4 + k, u.x >> 8);
    let h = T(e);
    let desert = h < 70 && Q(vec3f(vec3u(e + 128, 0).xzy), 256) > .7;
    let t = e / 8;
    let r = H(vec3u(t.x, 99, t.y));
    let s = t * 8 + 2 + vec2u(r * vec2f(40, 400)) % 4;
    let th = T(s);
    var below = 0u;
    for (var y = 0u; y < HEIGHT; y++) {
      let c = vec3u(e, y).xzy;
      let p = vec3f(c);
      let q = H(c);
      let d = p - vec3f(vec2f(s), th + 4).xzy;
      var b = 0u;
      if p.y > h {
        if r < .3 && th < 75 && th > SHORE && !desert && d.x == 0 && d.z == 0 && d.y < 1 && d.y > -4 { b = LOG; }
        else if r < .3 && th < 75 && th > SHORE && !desert && abs(d.y + .5) < 2 && dot(d, d) < 5.5 - q { b = LEAVES; }
        else if q < .3 && below == GRASS { b = 1 + u32(q > .05); }
        else if p.y <= SEA { b = WATER; }
      } else {
        let beach = desert || h <= SHORE;
        let w = u32(h > 80 + q * 8);
        b = GRASS + w * 2;
        if h > 95 + q * 6 { b = SNOW; }
        if p.y < h { b = DIRT + w; }
        if beach { b = SAND; }
        if p.y < h - 3 {
          b = STONE;
          if q < .015 { b = COAL; } else if q < .022 && p.y < 72 { b = IRON; } else if q < .025 && p.y < 24 { b = DIAMOND; }
        }
        if !(beach && p.y > h - 3) && Q(p, 32) > .78 { b = AIR; }
      }
      if p.y < 4 - 4 * q { b = BEDROCK; }
      below = b;
      W[(y << 18) + u.x] |= b << (k * 8);
    }
  }
  if u.x < 1 { S[0] = vec4f(434.5, 100, 511.5, 0); }
}
