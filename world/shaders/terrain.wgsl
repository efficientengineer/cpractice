// terrain.wgsl: the terrain height function, the mirror of engine/terrain.h (chapter 01; 06 extends it).
//   //#include "terrain.wgsl"
// A shader that includes this file must declare the parameters it reads, e.g.
//   @group(0) @binding(1) var<uniform> terrain: TerrainParams;
// terrain_eval(t, p) takes the parameters explicitly; terrain_height(p) uses that `terrain` variable.

//#include "noise.wgsl"

struct TerrainParams {
    seed: u32,
    octaves: i32,
    frequency: f32,
    height: f32,
    lacunarity: f32,
    gain: f32,
    warp: f32,
    ridge: f32,
}

fn terrain_eval(t: TerrainParams, p_in: vec2f) -> f32 {
    var p = p_in;
    if (t.warp > 0.0) { p = domain_warp2(p, t.seed ^ 0x1B873593u, t.warp, t.frequency); }
    let q = p * t.frequency;
    let hills = 0.5 + 0.5 * fbm2(q.x, q.y, t.seed, t.octaves, t.lacunarity, t.gain);
    let peaks = ridged2(q.x, q.y, t.seed ^ 0x85EBCA6Bu, t.octaves, t.lacunarity, t.gain);
    let h = hills + (peaks - hills) * t.ridge;
    return t.height * h * h;
}

fn terrain_height(p: vec2f) -> f32 {
    return terrain_eval(terrain, p);
}
