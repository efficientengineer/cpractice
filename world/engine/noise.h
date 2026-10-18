// noise.h: integer hashing and coherent noise (CPU module, chapter 01-noise).
// Mirrored exactly by shaders/noise.wgsl (same names, same math, f32 + u32 wrap-around):
// the GPU and CPU agree within 1e-3 at any point (tests/test_01_noise.c).
//
//   uint32_t hash_u32(uint32_t x)                                  PCG hash (Jarzynski & Olano 2020)
//   uint32_t hash2i(int32_t x, int32_t z, uint32_t seed)           hash of a 2D lattice point
//   uint32_t hash3i(int32_t x, int32_t y, int32_t z, uint32_t seed)
//   float    hash_to_unit(uint32_t h)                              top 24 bits -> [0, 1)
//   float    noise_fade(float t)                                   quintic 6t^5 - 15t^4 + 10t^3
//   float    noise_value2(float x, float y, uint32_t seed)         value noise, -1..1
//   float    noise_perlin2(float x, float y, uint32_t seed)        gradient noise, ~-1..1, 0 at lattice points
//   float    noise_perlin3(float x, float y, float z, uint32_t seed)  ~-1..1
//   float    noise_simplex2(float x, float y, uint32_t seed)       simplex noise, ~-1..1
//   float    fbm2(float x, float y, uint32_t seed, int octaves, float lacunarity, float gain)
//                                                                  Perlin fBm, normalized to ~-1..1
//   float    ridged2(float x, float y, uint32_t seed, int octaves, float lacunarity, float gain)
//                                                                  ridged multifractal, 0..1 (ridges near 1)
//   void     domain_warp2(float *x, float *y, uint32_t seed, float amount, float freq)
//                                                                  p += amount * (fbm2(p*freq), fbm2(p*freq + offset))
//
// Every function is a pure function of its arguments: no state, no rand(). Octave i of fbm2/ridged2
// uses seed + i, so octaves are independent.
#pragma once
#include <math.h>
#include <stdint.h>

static inline uint32_t hash_u32(uint32_t x) {
    uint32_t state = x * 747796405u + 2891336453u;
    uint32_t word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

// The seed is spread with the golden-ratio constant so seed s and s+1 are unrelated worlds,
// then each coordinate is folded in by another hash round (nesting, not XOR: no symmetry x<->z).
static inline uint32_t hash2i(int32_t x, int32_t z, uint32_t seed) {
    return hash_u32(hash_u32((uint32_t)x + seed * 0x9E3779B9u) + (uint32_t)z);
}

static inline uint32_t hash3i(int32_t x, int32_t y, int32_t z, uint32_t seed) {
    return hash_u32(hash_u32(hash_u32((uint32_t)x + seed * 0x9E3779B9u) + (uint32_t)y) + (uint32_t)z);
}

// 24 bits fit a float mantissa exactly, so the result is identical in C and WGSL.
static inline float hash_to_unit(uint32_t h) {
    return (float)(h >> 8u) * (1.0f / 16777216.0f);
}

static inline float noise_fade(float t) {
    return t * t * t * (t * (t * 6.0f - 15.0f) + 10.0f);
}

static inline float noise_lerp_(float a, float b, float t) { return a + (b - a) * t; }

static inline float noise_value2(float x, float y, uint32_t seed) {
    float fx = floorf(x), fy = floorf(y);
    int32_t ix = (int32_t)fx, iy = (int32_t)fy;
    float tx = x - fx, ty = y - fy;
    float a = hash_to_unit(hash2i(ix, iy, seed));
    float b = hash_to_unit(hash2i(ix + 1, iy, seed));
    float c = hash_to_unit(hash2i(ix, iy + 1, seed));
    float d = hash_to_unit(hash2i(ix + 1, iy + 1, seed));
    float u = noise_fade(tx), v = noise_fade(ty);
    return noise_lerp_(noise_lerp_(a, b, u), noise_lerp_(c, d, u), v) * 2.0f - 1.0f;
}

// Dot of one of 8 unit gradients (4 axes, 4 diagonals) picked by the hash with offset (x, y).
static inline float noise_grad2_(uint32_t h, float x, float y) {
    uint32_t k = h & 7u;
    float sx = (k & 1u) ? -1.0f : 1.0f;
    float sy = (k & 2u) ? -1.0f : 1.0f;
    if (k < 2u) return sx * x;                         // (+-1, 0)
    if (k < 4u) return sx * y;                         // (0, +-1)
    return 0.70710678f * (sx * x + sy * y);            // (+-1, +-1) / sqrt 2
}

static inline float noise_perlin2(float x, float y, uint32_t seed) {
    float fx = floorf(x), fy = floorf(y);
    int32_t ix = (int32_t)fx, iy = (int32_t)fy;
    float tx = x - fx, ty = y - fy;
    float a = noise_grad2_(hash2i(ix, iy, seed), tx, ty);
    float b = noise_grad2_(hash2i(ix + 1, iy, seed), tx - 1.0f, ty);
    float c = noise_grad2_(hash2i(ix, iy + 1, seed), tx, ty - 1.0f);
    float d = noise_grad2_(hash2i(ix + 1, iy + 1, seed), tx - 1.0f, ty - 1.0f);
    float u = noise_fade(tx), v = noise_fade(ty);
    // Unit gradients peak at sqrt(2)/2; scale to ~-1..1.
    return 1.41421356f * noise_lerp_(noise_lerp_(a, b, u), noise_lerp_(c, d, u), v);
}

// Ken Perlin's improved-noise gradients: the 12 cube edge midpoints (4 repeated to make 16).
static inline float noise_grad3_(uint32_t h, float x, float y, float z) {
    uint32_t k = h & 15u;
    float u = k < 8u ? x : y;
    float v = k < 4u ? y : ((k == 12u || k == 14u) ? x : z);
    return ((k & 1u) ? -u : u) + ((k & 2u) ? -v : v);
}

static inline float noise_perlin3(float x, float y, float z, uint32_t seed) {
    float fx = floorf(x), fy = floorf(y), fz = floorf(z);
    int32_t ix = (int32_t)fx, iy = (int32_t)fy, iz = (int32_t)fz;
    float tx = x - fx, ty = y - fy, tz = z - fz;
    float n000 = noise_grad3_(hash3i(ix, iy, iz, seed), tx, ty, tz);
    float n100 = noise_grad3_(hash3i(ix + 1, iy, iz, seed), tx - 1.0f, ty, tz);
    float n010 = noise_grad3_(hash3i(ix, iy + 1, iz, seed), tx, ty - 1.0f, tz);
    float n110 = noise_grad3_(hash3i(ix + 1, iy + 1, iz, seed), tx - 1.0f, ty - 1.0f, tz);
    float n001 = noise_grad3_(hash3i(ix, iy, iz + 1, seed), tx, ty, tz - 1.0f);
    float n101 = noise_grad3_(hash3i(ix + 1, iy, iz + 1, seed), tx - 1.0f, ty, tz - 1.0f);
    float n011 = noise_grad3_(hash3i(ix, iy + 1, iz + 1, seed), tx, ty - 1.0f, tz - 1.0f);
    float n111 = noise_grad3_(hash3i(ix + 1, iy + 1, iz + 1, seed), tx - 1.0f, ty - 1.0f, tz - 1.0f);
    float u = noise_fade(tx), v = noise_fade(ty), w = noise_fade(tz);
    float x00 = noise_lerp_(n000, n100, u), x10 = noise_lerp_(n010, n110, u);
    float x01 = noise_lerp_(n001, n101, u), x11 = noise_lerp_(n011, n111, u);
    return noise_lerp_(noise_lerp_(x00, x10, v), noise_lerp_(x01, x11, v), w);
}

// Simplex noise (Perlin 2001; Gustavson's "Simplex noise demystified" layout): 3 corners per
// sample instead of 4, no axis-aligned artifacts. Same 8 gradients as noise_perlin2.
static inline float noise_simplex2(float x, float y, uint32_t seed) {
    const float F2 = 0.36602540378f;                   // (sqrt 3 - 1) / 2
    const float G2 = 0.21132486540f;                   // (3 - sqrt 3) / 6
    float s = (x + y) * F2;
    float fi = floorf(x + s), fj = floorf(y + s);
    int32_t i = (int32_t)fi, j = (int32_t)fj;
    float t = (fi + fj) * G2;
    float x0 = x - (fi - t), y0 = y - (fj - t);
    int32_t i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;          // lower or upper triangle
    float x1 = x0 - (float)i1 + G2, y1 = y0 - (float)j1 + G2;
    float x2 = x0 - 1.0f + 2.0f * G2, y2 = y0 - 1.0f + 2.0f * G2;
    float n = 0.0f;
    float t0 = 0.5f - x0 * x0 - y0 * y0;
    if (t0 > 0.0f) { t0 *= t0; n += t0 * t0 * noise_grad2_(hash2i(i, j, seed), x0, y0); }
    float t1 = 0.5f - x1 * x1 - y1 * y1;
    if (t1 > 0.0f) { t1 *= t1; n += t1 * t1 * noise_grad2_(hash2i(i + i1, j + j1, seed), x1, y1); }
    float t2 = 0.5f - x2 * x2 - y2 * y2;
    if (t2 > 0.0f) { t2 *= t2; n += t2 * t2 * noise_grad2_(hash2i(i + 1, j + 1, seed), x2, y2); }
    return 99.204334f * n;                             // max |n| for unit gradients is 1/99.2
}

static inline float fbm2(float x, float y, uint32_t seed, int octaves, float lacunarity, float gain) {
    float sum = 0.0f, amp = 1.0f, norm = 0.0f;
    for (int i = 0; i < octaves; i++) {
        sum += amp * noise_perlin2(x, y, seed + (uint32_t)i);
        norm += amp;
        amp *= gain;
        x *= lacunarity;
        y *= lacunarity;
    }
    return norm > 0.0f ? sum / norm : 0.0f;
}

// Musgrave's ridged multifractal: 1 - |noise| turns zero crossings into sharp crests; squaring
// sharpens them, and weighting each octave by the previous one keeps valleys smooth.
static inline float ridged2(float x, float y, uint32_t seed, int octaves, float lacunarity, float gain) {
    float sum = 0.0f, amp = 1.0f, norm = 0.0f, weight = 1.0f;
    for (int i = 0; i < octaves; i++) {
        float s = 1.0f - fabsf(noise_perlin2(x, y, seed + (uint32_t)i));
        s = s * s * weight;
        weight = fminf(fmaxf(s * 2.0f, 0.0f), 1.0f);
        sum += amp * s;
        norm += amp;
        amp *= gain;
        x *= lacunarity;
        y *= lacunarity;
    }
    return norm > 0.0f ? sum / norm : 0.0f;
}

// Domain warping (Quilez, "Warping"): offset the input by a vector of two fBm fields.
static inline void domain_warp2(float *x, float *y, uint32_t seed, float amount, float freq) {
    float px = *x * freq, py = *y * freq;
    float qx = fbm2(px, py, seed ^ 0xA511E9B3u, 3, 2.0f, 0.5f);
    float qy = fbm2(px + 5.2f, py + 1.3f, seed ^ 0x63D83595u, 3, 2.0f, 0.5f);
    *x += amount * qx;
    *y += amount * qy;
}
