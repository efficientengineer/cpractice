// noise.wgsl: integer hashing and coherent noise (chapter 01-noise). Include with
//   //#include "noise.wgsl"
// The exact mirror of engine/noise.h: same names, same math, so CPU and GPU agree within 1e-3
// (tests/test_01_noise.c). u32 arithmetic wraps in WGSL exactly like uint32_t in C.
//
//   hash_u32(x: u32) -> u32                       PCG hash (Jarzynski & Olano 2020)
//   hash2i(x: i32, z: i32, seed: u32) -> u32
//   hash3i(x: i32, y: i32, z: i32, seed: u32) -> u32
//   hash_to_unit(h: u32) -> f32                   [0, 1)
//   noise_fade(t: f32) -> f32                     6t^5 - 15t^4 + 10t^3
//   noise_value2(x, y: f32, seed: u32) -> f32     -1..1
//   noise_perlin2(x, y: f32, seed: u32) -> f32    ~-1..1
//   noise_perlin3(x, y, z: f32, seed: u32) -> f32 ~-1..1
//   noise_simplex2(x, y: f32, seed: u32) -> f32   ~-1..1
//   fbm2(x, y: f32, seed: u32, octaves: i32, lacunarity: f32, gain: f32) -> f32   ~-1..1
//   ridged2(x, y: f32, seed: u32, octaves: i32, lacunarity: f32, gain: f32) -> f32  0..1
//   domain_warp2(p: vec2f, seed: u32, amount: f32, freq: f32) -> vec2f
//       (C: domain_warp2(&x, &y, ...) warps in place; WGSL returns the warped point)

fn hash_u32(x: u32) -> u32 {
    let state = x * 747796405u + 2891336453u;
    let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

fn hash2i(x: i32, z: i32, seed: u32) -> u32 {
    return hash_u32(hash_u32(bitcast<u32>(x) + seed * 0x9E3779B9u) + bitcast<u32>(z));
}

fn hash3i(x: i32, y: i32, z: i32, seed: u32) -> u32 {
    return hash_u32(hash_u32(hash_u32(bitcast<u32>(x) + seed * 0x9E3779B9u) + bitcast<u32>(y)) + bitcast<u32>(z));
}

fn hash_to_unit(h: u32) -> f32 {
    return f32(h >> 8u) * (1.0 / 16777216.0);
}

fn noise_fade(t: f32) -> f32 {
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

fn noise_value2(x: f32, y: f32, seed: u32) -> f32 {
    let f = floor(vec2f(x, y));
    let i = vec2i(f);
    let t = vec2f(x, y) - f;
    let a = hash_to_unit(hash2i(i.x, i.y, seed));
    let b = hash_to_unit(hash2i(i.x + 1, i.y, seed));
    let c = hash_to_unit(hash2i(i.x, i.y + 1, seed));
    let d = hash_to_unit(hash2i(i.x + 1, i.y + 1, seed));
    let u = noise_fade(t.x);
    let v = noise_fade(t.y);
    return mix(mix(a, b, u), mix(c, d, u), v) * 2.0 - 1.0;
}

// One of 8 unit gradients (4 axes, 4 diagonals) dotted with the offset (x, y).
fn noise_grad2_(h: u32, x: f32, y: f32) -> f32 {
    let k = h & 7u;
    let sx = select(1.0, -1.0, (k & 1u) != 0u);
    let sy = select(1.0, -1.0, (k & 2u) != 0u);
    if (k < 2u) { return sx * x; }
    if (k < 4u) { return sx * y; }
    return 0.70710678 * (sx * x + sy * y);
}

fn noise_perlin2(x: f32, y: f32, seed: u32) -> f32 {
    let f = floor(vec2f(x, y));
    let i = vec2i(f);
    let t = vec2f(x, y) - f;
    let a = noise_grad2_(hash2i(i.x, i.y, seed), t.x, t.y);
    let b = noise_grad2_(hash2i(i.x + 1, i.y, seed), t.x - 1.0, t.y);
    let c = noise_grad2_(hash2i(i.x, i.y + 1, seed), t.x, t.y - 1.0);
    let d = noise_grad2_(hash2i(i.x + 1, i.y + 1, seed), t.x - 1.0, t.y - 1.0);
    let u = noise_fade(t.x);
    let v = noise_fade(t.y);
    return 1.41421356 * mix(mix(a, b, u), mix(c, d, u), v);
}

// Improved-noise gradients: the 12 cube edge midpoints.
fn noise_grad3_(h: u32, x: f32, y: f32, z: f32) -> f32 {
    let k = h & 15u;
    let u = select(y, x, k < 8u);
    let v = select(select(z, x, k == 12u || k == 14u), y, k < 4u);
    return select(u, -u, (k & 1u) != 0u) + select(v, -v, (k & 2u) != 0u);
}

fn noise_perlin3(x: f32, y: f32, z: f32, seed: u32) -> f32 {
    let f = floor(vec3f(x, y, z));
    let i = vec3i(f);
    let t = vec3f(x, y, z) - f;
    let n000 = noise_grad3_(hash3i(i.x, i.y, i.z, seed), t.x, t.y, t.z);
    let n100 = noise_grad3_(hash3i(i.x + 1, i.y, i.z, seed), t.x - 1.0, t.y, t.z);
    let n010 = noise_grad3_(hash3i(i.x, i.y + 1, i.z, seed), t.x, t.y - 1.0, t.z);
    let n110 = noise_grad3_(hash3i(i.x + 1, i.y + 1, i.z, seed), t.x - 1.0, t.y - 1.0, t.z);
    let n001 = noise_grad3_(hash3i(i.x, i.y, i.z + 1, seed), t.x, t.y, t.z - 1.0);
    let n101 = noise_grad3_(hash3i(i.x + 1, i.y, i.z + 1, seed), t.x - 1.0, t.y, t.z - 1.0);
    let n011 = noise_grad3_(hash3i(i.x, i.y + 1, i.z + 1, seed), t.x, t.y - 1.0, t.z - 1.0);
    let n111 = noise_grad3_(hash3i(i.x + 1, i.y + 1, i.z + 1, seed), t.x - 1.0, t.y - 1.0, t.z - 1.0);
    let u = noise_fade(t.x);
    let v = noise_fade(t.y);
    let w = noise_fade(t.z);
    let x00 = mix(n000, n100, u);
    let x10 = mix(n010, n110, u);
    let x01 = mix(n001, n101, u);
    let x11 = mix(n011, n111, u);
    return mix(mix(x00, x10, v), mix(x01, x11, v), w);
}

fn noise_simplex2(x: f32, y: f32, seed: u32) -> f32 {
    let F2 = 0.36602540378;
    let G2 = 0.21132486540;
    let s = (x + y) * F2;
    let fi = floor(x + s);
    let fj = floor(y + s);
    let i = i32(fi);
    let j = i32(fj);
    let t = (fi + fj) * G2;
    let x0 = x - (fi - t);
    let y0 = y - (fj - t);
    let i1 = select(0, 1, x0 > y0);
    let j1 = 1 - i1;
    let x1 = x0 - f32(i1) + G2;
    let y1 = y0 - f32(j1) + G2;
    let x2 = x0 - 1.0 + 2.0 * G2;
    let y2 = y0 - 1.0 + 2.0 * G2;
    var n = 0.0;
    var t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0.0) { t0 *= t0; n += t0 * t0 * noise_grad2_(hash2i(i, j, seed), x0, y0); }
    var t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0.0) { t1 *= t1; n += t1 * t1 * noise_grad2_(hash2i(i + i1, j + j1, seed), x1, y1); }
    var t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0.0) { t2 *= t2; n += t2 * t2 * noise_grad2_(hash2i(i + 1, j + 1, seed), x2, y2); }
    return 99.204334 * n;
}

fn fbm2(x: f32, y: f32, seed: u32, octaves: i32, lacunarity: f32, gain: f32) -> f32 {
    var p = vec2f(x, y);
    var sum = 0.0;
    var amp = 1.0;
    var norm = 0.0;
    for (var i = 0; i < octaves; i++) {
        sum += amp * noise_perlin2(p.x, p.y, seed + u32(i));
        norm += amp;
        amp *= gain;
        p *= lacunarity;
    }
    return select(0.0, sum / norm, norm > 0.0);
}

fn ridged2(x: f32, y: f32, seed: u32, octaves: i32, lacunarity: f32, gain: f32) -> f32 {
    var p = vec2f(x, y);
    var sum = 0.0;
    var amp = 1.0;
    var norm = 0.0;
    var weight = 1.0;
    for (var i = 0; i < octaves; i++) {
        var s = 1.0 - abs(noise_perlin2(p.x, p.y, seed + u32(i)));
        s = s * s * weight;
        weight = clamp(s * 2.0, 0.0, 1.0);
        sum += amp * s;
        norm += amp;
        amp *= gain;
        p *= lacunarity;
    }
    return select(0.0, sum / norm, norm > 0.0);
}

fn domain_warp2(p: vec2f, seed: u32, amount: f32, freq: f32) -> vec2f {
    let q = p * freq;
    let qx = fbm2(q.x, q.y, seed ^ 0xA511E9B3u, 3, 2.0, 0.5);
    let qy = fbm2(q.x + 5.2, q.y + 1.3, seed ^ 0x63D83595u, 3, 2.0, 0.5);
    return p + amount * vec2f(qx, qy);
}
