// terrain.h: the terrain height function (CPU module, chapter 01-noise; chapter 06-shaping extends it).
// shaders/terrain.wgsl is the exact GPU mirror; they agree within 1e-3 m (tests/test_01_noise.c).
//
//   typedef struct TerrainParams { seed, octaves, frequency, height, lacunarity, gain, warp, ridge }
//                                         32 bytes, same layout as WGSL struct TerrainParams (uniform)
//   TerrainParams terrain_default(uint32_t seed)          rolling hills with ridged mountains, ~0..400 m
//   float terrain_height(const TerrainParams *p, float x, float z)   height in meters at world (x, z)
//
// Pure function of (params, x, z): any chunk, any thread, CPU or GPU gets the same answer, which is
// what lets physics (CPU) walk on terrain the GPU generated.
#pragma once
#include "noise.h"
#include <stdint.h>

typedef struct TerrainParams {
    uint32_t seed;
    int32_t octaves;       // fBm octaves (detail levels)
    float frequency;       // 1 / size of the largest features, in 1/m
    float height;          // vertical scale in meters
    float lacunarity;      // frequency multiplier per octave (~2)
    float gain;            // amplitude multiplier per octave (~0.5)
    float warp;            // domain warp distance in meters (0 = none)
    float ridge;           // 0 = smooth fBm hills .. 1 = ridged mountains
} TerrainParams;

static inline TerrainParams terrain_default(uint32_t seed) {
    return (TerrainParams){ .seed = seed, .octaves = 6, .frequency = 1.0f / 1200.0f, .height = 400.0f,
                            .lacunarity = 2.0f, .gain = 0.5f, .warp = 250.0f, .ridge = 0.6f };
}

static inline float terrain_height(const TerrainParams *p, float x, float z) {
    if (p->warp > 0.0f) domain_warp2(&x, &z, p->seed ^ 0x1B873593u, p->warp, p->frequency);
    float u = x * p->frequency, v = z * p->frequency;
    float hills = 0.5f + 0.5f * fbm2(u, v, p->seed, p->octaves, p->lacunarity, p->gain);
    float peaks = ridged2(u, v, p->seed ^ 0x85EBCA6Bu, p->octaves, p->lacunarity, p->gain);
    float h = hills + (peaks - hills) * p->ridge;
    return p->height * h * h;   // squaring flattens lowlands into valleys and keeps peaks sharp
}
