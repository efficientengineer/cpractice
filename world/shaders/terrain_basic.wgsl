// The chapter 03 terrain height function: WGSL twin of engine/terrain_basic.h (same struct
// layout, same math), so the CPU can walk on what the GPU draws. Chapter 06 replaces it.
//#include "noise.wgsl"

struct TerrainBasic {
    seed: u32,
    octaves: i32,
    frequency: f32,
    amplitude: f32,
    lacunarity: f32,
    gain: f32,
    warp: f32,
    base: f32,
}

fn terrain_basic_height(t: TerrainBasic, x: f32, z: f32) -> f32 {
    var px = x * t.frequency;
    var pz = z * t.frequency;
    if (t.warp > 0.0) { domain_warp2(&px, &pz, t.seed, t.warp, 0.5); }
    let n = fbm2(px, pz, t.seed, t.octaves, t.lacunarity, t.gain);
    let s = max(n * 0.5 + 0.5, 0.0);
    return t.base + t.amplitude * s * s;
}
