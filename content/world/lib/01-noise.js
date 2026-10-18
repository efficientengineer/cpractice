// Procedural World engine, chapter 01: integer hashing, counter-based RNG, noise (JS + WGSL), a first terrain.
//
// Every function exists twice, in JS (W.hash/W.noise/W.terrain) and WGSL (W.wgsl.hash/noise/terrain),
// and the two agree within 1e-3 at test points (the WGSL runs in f32, the JS in f64).
//
// Public API:
//   W.hash.pcg(v)              -> u32   PCG hash of a u32 (Jarzynski & Olano 2020, "Hash Functions for GPU Rendering")
//   W.hash.hash2(x, y, seed)   -> u32   hash of two integers (any sign) and a seed
//   W.hash.hash3(x, y, z, seed)-> u32
//   W.hash.toFloat(h)          -> [0,1) from the top 24 bits (exact in f32, so identical on CPU and GPU)
//   W.hash.float2(x, y, seed)  -> [0,1)
//   W.rng(seed)                -> { next() u32, float() [0,1), range(a, b), int(n) [0,n), index }  counter-based stream
//   W.noise.value2(x, y, seed)    -> ~[-1,1]  value noise, quintic interpolation
//   W.noise.perlin2(x, y, seed)   -> ~[-1,1]  gradient noise, hashed unit gradients
//   W.noise.simplex2(x, y, seed)  -> ~[-1,1]
//   W.noise.perlin3(x, y, z, seed)-> ~[-1,1]
//   W.noise.fbm2(x, y, seed, octaves=5, lacunarity=2, gain=0.5)     -> ~[-1,1] (normalised by total amplitude)
//   W.noise.ridged2(x, y, seed, octaves=5, lacunarity=2, gain=0.5)  -> [0,1]   ridged multifractal (Musgrave)
//   W.noise.warp2(x, y, seed, octaves=5, strength=1)                -> ~[-1,1] fbm of a domain warped by fbm (Quilez)
//   W.terrain.params             default terrain parameters { seed, frequency, amplitude, octaves, lacunarity, gain, warp, ridge, base }
//   W.terrain.height(x, z, p?)   -> metres  the terrain surface at world (x, z)
//   W.terrain.normal(x, z, out?, p?, eps=0.5) -> unit normal (central differences) in out (Float32Array(3))
//   W.wgsl.hash     WGSL: pcg(u32), hash2(vec2i, u32), hash3(vec3i, u32), hashToFloat(u32), hashFloat2(vec2i, u32)
//   W.wgsl.noise    WGSL (needs W.wgsl.hash): noiseValue2(p: vec2f, seed: u32), noisePerlin2, noiseSimplex2,
//                   noisePerlin3(p: vec3f, seed), noiseFbm2(p, seed, octaves: i32, lacunarity, gain),
//                   noiseRidged2(p, seed, octaves, lacunarity, gain), noiseWarp2(p, seed, octaves, strength)
//   W.wgsl.terrain(p?) -> WGSL (needs hash + noise): fn terrainHeight(p: vec2f) -> f32 with the params baked in as constants
self.W = self.W || {};
W.wgsl = W.wgsl || {};

(function () {
  // ================================================================ hashing
  // Why not fract(sin(x) * 43758.5453)? sin's precision differs between GPUs and between f32 and
  // f64, so the "random" values differ across machines and between CPU and GPU; and large inputs
  // collapse into visible patterns. Integer hashes are exact everywhere: same bits on every device.
  const imul = Math.imul;
  function pcg(v) {
    const state = (imul(v, 747796405) + 2891336453) >>> 0;
    const word = imul((state >>> ((state >>> 28) + 4)) ^ state, 277803737) >>> 0;
    return ((word >>> 22) ^ word) >>> 0;
  }
  // Nesting pcg combines inputs; mixing the seed first keeps seed s+1 uncorrelated with seed s.
  // (x >>> 0) reinterprets a negative int as u32, like WGSL's bitcast<u32>(i32).
  function hash2(x, y, seed) { return pcg(((x >>> 0) + pcg(((y >>> 0) + pcg(seed >>> 0)) >>> 0)) >>> 0); }
  function hash3(x, y, z, seed) { return pcg(((x >>> 0) + pcg(((y >>> 0) + pcg(((z >>> 0) + pcg(seed >>> 0)) >>> 0)) >>> 0)) >>> 0); }
  const INV24 = 1 / 16777216;
  function toFloat(h) { return (h >>> 8) * INV24; }   // 24 bits: every value is exactly representable in f32
  W.hash = { pcg, hash2, hash3, toFloat, float2: (x, y, seed) => toFloat(hash2(x, y, seed)) };

  // Counter-based RNG: value i of stream `seed` is hash(seed, i). Any value can be computed without
  // generating the ones before it, and two streams never share state, so generation order (which
  // chunk loads first) can't change the world.
  W.rng = function rng(seed) {
    const s = pcg(seed >>> 0);
    const r = {
      index: 0,
      next() { return pcg((s + r.index++) >>> 0); },
      float() { return toFloat(r.next()); },
      range(a, b) { return a + (b - a) * r.float(); },
      int(n) { return Math.floor(r.float() * n); }
    };
    return r;
  };

  // ================================================================ noise
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);       // quintic: C2-continuous (smooth normals)
  const lerp = (a, b, t) => a + (b - a) * t;
  const TAU = Math.PI * 2;

  // Value noise: random heights at lattice points, smoothly interpolated. Cheap, but blobby and
  // aligned to the grid.
  function value2(x, y, seed) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const a = toFloat(hash2(ix, iy, seed)), b = toFloat(hash2(ix + 1, iy, seed));
    const c = toFloat(hash2(ix, iy + 1, seed)), d = toFloat(hash2(ix + 1, iy + 1, seed));
    const u = fade(fx), v = fade(fy);
    return lerp(lerp(a, b, u), lerp(c, d, u), v) * 2 - 1;
  }

  // Gradient (Perlin) noise: a random unit gradient at each lattice point; the value is the
  // interpolated dot(gradient, offset). Zero at every lattice point, so fewer grid artifacts.
  function grad2(ix, iy, seed, dx, dy) {
    const a = toFloat(hash2(ix, iy, seed)) * TAU;
    return Math.cos(a) * dx + Math.sin(a) * dy;
  }
  function perlin2(x, y, seed) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const a = grad2(ix, iy, seed, fx, fy), b = grad2(ix + 1, iy, seed, fx - 1, fy);
    const c = grad2(ix, iy + 1, seed, fx, fy - 1), d = grad2(ix + 1, iy + 1, seed, fx - 1, fy - 1);
    return lerp(lerp(a, b, fade(fx)), lerp(c, d, fade(fx)), fade(fy)) * 1.4142135;   // max |value| is 1/sqrt(2)
  }

  // Simplex noise: a triangular lattice (3 corners instead of 4), radial falloff kernels, no
  // interpolation. Fewer directional artifacts and cheaper in higher dimensions.
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  function corner2(ix, iy, seed, dx, dy) {
    const t = 0.5 - dx * dx - dy * dy;
    if (t <= 0) return 0;
    const t2 = t * t;
    return t2 * t2 * grad2(ix, iy, seed, dx, dy);
  }
  function simplex2(x, y, seed) {
    const s = (x + y) * F2, i = Math.floor(x + s), j = Math.floor(y + s);
    const t = (i + j) * G2, x0 = x - (i - t), y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    return 99.2 * (corner2(i, j, seed, x0, y0) + corner2(i + i1, j + j1, seed, x1, y1) + corner2(i + 1, j + 1, seed, x2, y2));
  }

  // 3D gradient noise with Perlin's 12 cube-edge gradients (needed later for rocks and volumes).
  function grad3(h, x, y, z) {
    h &= 15;
    const u = h < 8 ? x : y, v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
  }
  function corner3(ix, iy, iz, seed, dx, dy, dz) { return grad3(hash3(ix, iy, iz, seed), dx, dy, dz); }
  function perlin3(x, y, z, seed) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = x - ix, fy = y - iy, fz = z - iz, u = fade(fx), v = fade(fy), w = fade(fz);
    const g000 = corner3(ix, iy, iz, seed, fx, fy, fz), g100 = corner3(ix + 1, iy, iz, seed, fx - 1, fy, fz);
    const g010 = corner3(ix, iy + 1, iz, seed, fx, fy - 1, fz), g110 = corner3(ix + 1, iy + 1, iz, seed, fx - 1, fy - 1, fz);
    const g001 = corner3(ix, iy, iz + 1, seed, fx, fy, fz - 1), g101 = corner3(ix + 1, iy, iz + 1, seed, fx - 1, fy, fz - 1);
    const g011 = corner3(ix, iy + 1, iz + 1, seed, fx, fy - 1, fz - 1), g111 = corner3(ix + 1, iy + 1, iz + 1, seed, fx - 1, fy - 1, fz - 1);
    return lerp(lerp(lerp(g000, g100, u), lerp(g010, g110, u), v), lerp(lerp(g001, g101, u), lerp(g011, g111, u), v), w);
  }

  // Fractal Brownian motion: octaves of noise at doubling frequency and halving amplitude.
  // Each octave gets its own seed so octaves don't line up at the origin.
  function fbm2(x, y, seed, octaves = 5, lacunarity = 2, gain = 0.5) {
    let sum = 0, amp = 1, norm = 0, f = 1;
    for (let i = 0; i < octaves; i++) {
      sum += amp * perlin2(x * f, y * f, (seed + i) >>> 0);
      norm += amp; amp *= gain; f *= lacunarity;
    }
    return sum / norm;
  }
  // Ridged multifractal: 1-|n| turns zero crossings into sharp crests; squaring sharpens them, and
  // weighting each octave by the previous one keeps detail on ridges and smooth valleys.
  function ridged2(x, y, seed, octaves = 5, lacunarity = 2, gain = 0.5) {
    let sum = 0, amp = 1, norm = 0, f = 1, weight = 1;
    for (let i = 0; i < octaves; i++) {
      let r = 1 - Math.abs(perlin2(x * f, y * f, (seed + i) >>> 0));
      r *= r;
      const contrib = r * weight;
      weight = Math.min(Math.max(contrib * 2, 0), 1);
      sum += amp * contrib; norm += amp; amp *= gain; f *= lacunarity;
    }
    return sum / norm;
  }
  // Domain warping: offset the input by another noise field before sampling (folds, swirls, erosion-like shapes).
  function warp2(x, y, seed, octaves = 5, strength = 1) {
    const qx = fbm2(x + 1.7, y + 9.2, (seed + 1013) >>> 0, 3);
    const qy = fbm2(x + 8.3, y + 2.8, (seed + 2027) >>> 0, 3);
    return fbm2(x + strength * qx, y + strength * qy, seed, octaves);
  }
  W.noise = { value2, perlin2, simplex2, perlin3, fbm2, ridged2, warp2, fade };

  // ================================================================ a first terrain
  // Chapter 06 replaces this with designed landforms; the interface (params object, height(x, z),
  // WGSL terrainHeight) stays the same. Rolling fBm hills everywhere plus ridged mountains where a
  // low-frequency mask says so, all on a lightly warped domain.
  const params = { seed: 1337, frequency: 1 / 320, amplitude: 70, octaves: 6, lacunarity: 2, gain: 0.5, warp: 0.35, ridge: 1.0, base: 0 };
  function height(x, z, p = params) {
    const fx = x * p.frequency, fz = z * p.frequency, s = p.seed >>> 0;
    const wx = fx + p.warp * fbm2(fx * 0.5 + 3.1, fz * 0.5 + 7.7, (s + 11) >>> 0, 3);
    const wz = fz + p.warp * fbm2(fx * 0.5 - 5.3, fz * 0.5 + 1.9, (s + 23) >>> 0, 3);
    const hills = fbm2(wx, wz, s, p.octaves, p.lacunarity, p.gain);
    const ridges = ridged2(wx * 0.5, wz * 0.5, (s + 101) >>> 0, p.octaves - 1, p.lacunarity, p.gain);
    const m = Math.min(Math.max((fbm2(fx * 0.25, fz * 0.25, (s + 202) >>> 0, 2) + 0.1) / 0.6, 0), 1);
    const mask = m * m * (3 - 2 * m);
    return p.base + p.amplitude * (0.35 * hills + p.ridge * mask * ridges);
  }
  function normal(x, z, out = new Float32Array(3), p = params, eps = 0.5) {
    const dx = height(x - eps, z, p) - height(x + eps, z, p);
    const dz = height(x, z - eps, p) - height(x, z + eps, p);
    const ny = 2 * eps, l = Math.hypot(dx, ny, dz);
    out[0] = dx / l; out[1] = ny / l; out[2] = dz / l;
    return out;
  }
  W.terrain = { params, height, normal };

  // ================================================================ WGSL
  W.wgsl.hash = /* wgsl */`
fn pcg(v: u32) -> u32 {
  let state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
fn hash2(p: vec2i, seed: u32) -> u32 { return pcg(bitcast<u32>(p.x) + pcg(bitcast<u32>(p.y) + pcg(seed))); }
fn hash3(p: vec3i, seed: u32) -> u32 { return pcg(bitcast<u32>(p.x) + pcg(bitcast<u32>(p.y) + pcg(bitcast<u32>(p.z) + pcg(seed)))); }
fn hashToFloat(h: u32) -> f32 { return f32(h >> 8u) * (1.0 / 16777216.0); }
fn hashFloat2(p: vec2i, seed: u32) -> f32 { return hashToFloat(hash2(p, seed)); }
`;

  W.wgsl.noise = /* wgsl */`
fn noiseFade(t: vec2f) -> vec2f { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
fn noiseValue2(p: vec2f, seed: u32) -> f32 {
  let i = vec2i(floor(p)); let f = p - floor(p); let u = noiseFade(f);
  let a = hashFloat2(i, seed);                 let b = hashFloat2(i + vec2i(1, 0), seed);
  let c = hashFloat2(i + vec2i(0, 1), seed);   let d = hashFloat2(i + vec2i(1, 1), seed);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}
fn noiseGrad2(i: vec2i, seed: u32, d: vec2f) -> f32 {
  let a = hashFloat2(i, seed) * 6.28318530718;
  return cos(a) * d.x + sin(a) * d.y;
}
fn noisePerlin2(p: vec2f, seed: u32) -> f32 {
  let i = vec2i(floor(p)); let f = p - floor(p); let u = noiseFade(f);
  let a = noiseGrad2(i, seed, f);
  let b = noiseGrad2(i + vec2i(1, 0), seed, f - vec2f(1.0, 0.0));
  let c = noiseGrad2(i + vec2i(0, 1), seed, f - vec2f(0.0, 1.0));
  let d = noiseGrad2(i + vec2i(1, 1), seed, f - vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.4142135;
}
fn noiseSimplexCorner(i: vec2i, seed: u32, d: vec2f) -> f32 {
  let t = 0.5 - dot(d, d);
  if (t <= 0.0) { return 0.0; }
  let t2 = t * t;
  return t2 * t2 * noiseGrad2(i, seed, d);
}
fn noiseSimplex2(p: vec2f, seed: u32) -> f32 {
  let F2 = 0.36602540378; let G2 = 0.21132486540;
  let s = (p.x + p.y) * F2;
  let i = floor(p + s);
  let t = (i.x + i.y) * G2;
  let d0 = p - (i - t);
  let o = select(vec2f(0.0, 1.0), vec2f(1.0, 0.0), d0.x > d0.y);
  let d1 = d0 - o + G2;
  let d2 = d0 - 1.0 + 2.0 * G2;
  let ii = vec2i(i);
  return 99.2 * (noiseSimplexCorner(ii, seed, d0) + noiseSimplexCorner(ii + vec2i(o), seed, d1) + noiseSimplexCorner(ii + vec2i(1, 1), seed, d2));
}
fn noiseGrad3(hash: u32, x: f32, y: f32, z: f32) -> f32 {
  let h = hash & 15u;
  let u = select(y, x, h < 8u);
  let v = select(select(z, x, h == 12u || h == 14u), y, h < 4u);
  return select(u, -u, (h & 1u) != 0u) + select(v, -v, (h & 2u) != 0u);
}
fn noisePerlin3(p: vec3f, seed: u32) -> f32 {
  let i = vec3i(floor(p)); let f = p - floor(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let g000 = noiseGrad3(hash3(i, seed), f.x, f.y, f.z);
  let g100 = noiseGrad3(hash3(i + vec3i(1, 0, 0), seed), f.x - 1.0, f.y, f.z);
  let g010 = noiseGrad3(hash3(i + vec3i(0, 1, 0), seed), f.x, f.y - 1.0, f.z);
  let g110 = noiseGrad3(hash3(i + vec3i(1, 1, 0), seed), f.x - 1.0, f.y - 1.0, f.z);
  let g001 = noiseGrad3(hash3(i + vec3i(0, 0, 1), seed), f.x, f.y, f.z - 1.0);
  let g101 = noiseGrad3(hash3(i + vec3i(1, 0, 1), seed), f.x - 1.0, f.y, f.z - 1.0);
  let g011 = noiseGrad3(hash3(i + vec3i(0, 1, 1), seed), f.x, f.y - 1.0, f.z - 1.0);
  let g111 = noiseGrad3(hash3(i + vec3i(1, 1, 1), seed), f.x - 1.0, f.y - 1.0, f.z - 1.0);
  return mix(mix(mix(g000, g100, u.x), mix(g010, g110, u.x), u.y),
             mix(mix(g001, g101, u.x), mix(g011, g111, u.x), u.y), u.z);
}
fn noiseFbm2(p: vec2f, seed: u32, octaves: i32, lacunarity: f32, gain: f32) -> f32 {
  var sum = 0.0; var amp = 1.0; var norm = 0.0; var f = 1.0;
  for (var i = 0; i < octaves; i++) {
    sum += amp * noisePerlin2(p * f, seed + u32(i));
    norm += amp; amp *= gain; f *= lacunarity;
  }
  return sum / norm;
}
fn noiseRidged2(p: vec2f, seed: u32, octaves: i32, lacunarity: f32, gain: f32) -> f32 {
  var sum = 0.0; var amp = 1.0; var norm = 0.0; var f = 1.0; var weight = 1.0;
  for (var i = 0; i < octaves; i++) {
    var r = 1.0 - abs(noisePerlin2(p * f, seed + u32(i)));
    r *= r;
    let contrib = r * weight;
    weight = clamp(contrib * 2.0, 0.0, 1.0);
    sum += amp * contrib; norm += amp; amp *= gain; f *= lacunarity;
  }
  return sum / norm;
}
fn noiseWarp2(p: vec2f, seed: u32, octaves: i32, strength: f32) -> f32 {
  let q = vec2f(noiseFbm2(p + vec2f(1.7, 9.2), seed + 1013u, 3, 2.0, 0.5),
                noiseFbm2(p + vec2f(8.3, 2.8), seed + 2027u, 3, 2.0, 0.5));
  return noiseFbm2(p + strength * q, seed, octaves, 2.0, 0.5);
}
`;

  // WGSL float literal that is always an f32 (e.g. 70 -> "70.0", 1/320 -> "0.003125").
  const f = x => { const s = String(x); return /[.eE]/.test(s) ? s : s + '.0'; };
  W.wgsl.f32 = f;
  W.wgsl.terrain = function terrainWGSL(p = params) {
    const s = p.seed >>> 0;
    return /* wgsl */`
fn terrainHeight(pos: vec2f) -> f32 {
  let fp = pos * ${f(p.frequency)};
  let w = vec2f(noiseFbm2(fp * 0.5 + vec2f(3.1, 7.7), ${(s + 11) >>> 0}u, 3, 2.0, 0.5),
                noiseFbm2(fp * 0.5 + vec2f(-5.3, 1.9), ${(s + 23) >>> 0}u, 3, 2.0, 0.5));
  let wp = fp + ${f(p.warp)} * w;
  let hills = noiseFbm2(wp, ${s}u, ${p.octaves | 0}, ${f(p.lacunarity)}, ${f(p.gain)});
  let ridges = noiseRidged2(wp * 0.5, ${(s + 101) >>> 0}u, ${(p.octaves - 1) | 0}, ${f(p.lacunarity)}, ${f(p.gain)});
  let mask = smoothstep(0.0, 1.0, clamp((noiseFbm2(fp * 0.25, ${(s + 202) >>> 0}u, 2, 2.0, 0.5) + 0.1) / 0.6, 0.0, 1.0));
  return ${f(p.base)} + ${f(p.amplitude)} * (0.35 * hills + ${f(p.ridge)} * mask * ridges);
}
`;
  };
})();
