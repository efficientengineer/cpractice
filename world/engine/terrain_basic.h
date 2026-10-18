// terrain_basic.h: a first terrain height function (CPU module, chapter 03-terrain).
// Warped fBm, squared so valleys flatten and peaks sharpen. Chapter 06 replaces it with real
// landform design (terrain.h); the shape of the API stays: params struct + pure height function.
// Mirrored exactly by shaders/terrain_basic.wgsl (same struct layout, same math); the GPU and CPU
// agree within 1e-3 m (tests/test_03_terrain.c), which is what lets the CPU walk on GPU terrain.
//
//   TerrainBasic                                       32 bytes, same layout as the WGSL struct
//   TerrainBasic terrain_basic_default(uint32_t seed)  rolling hills: ~1.5 km features, heights ~5..130 m
//   float terrain_basic_height(const TerrainBasic *t, float x, float z)   height in meters at (x, z)
//   float terrain_basic_sample(const void *t, float x, float z)          same, void* context
//                                                      (fits `float (*)(const void *, float, float)` callbacks)
#pragma once
#include "noise.h"
#include <stdint.h>

typedef struct TerrainBasic {
    uint32_t seed;
    int32_t octaves;     // fBm octaves (detail levels)
    float frequency;     // features per meter of the first octave (1 / wavelength)
    float amplitude;     // meters from the lowest valley to the highest peak
    float lacunarity;    // frequency multiplier per octave (~2)
    float gain;          // amplitude multiplier per octave (~0.5)
    float warp;          // domain warp strength in noise units (0 = none)
    float base;          // height offset in meters
} TerrainBasic;

static inline TerrainBasic terrain_basic_default(uint32_t seed) {
    return (TerrainBasic){ .seed = seed, .octaves = 6, .frequency = 1.0f / 1500.0f, .amplitude = 180.0f,
                           .lacunarity = 2.0f, .gain = 0.5f, .warp = 0.6f, .base = 0.0f };
}

static inline float terrain_basic_height(const TerrainBasic *t, float x, float z) {
    float px = x * t->frequency, pz = z * t->frequency;
    if (t->warp > 0.0f) domain_warp2(&px, &pz, t->seed, t->warp, 0.5f);
    float n = fbm2(px, pz, t->seed, t->octaves, t->lacunarity, t->gain);   // ~-1..1
    float s = n * 0.5f + 0.5f;
    if (s < 0.0f) s = 0.0f;
    return t->base + t->amplitude * s * s;
}

static inline float terrain_basic_sample(const void *t, float x, float z) {
    return terrain_basic_height((const TerrainBasic *)t, x, z);
}
