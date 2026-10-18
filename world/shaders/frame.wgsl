// The per-frame uniforms (chapter 03), bound at group 0 binding 0 in every world pipeline.
// Mirrors FrameUniforms in engine/frame.h byte for byte. Later chapters only append fields.
// mat4x4f is 64 bytes; a vec3f is aligned to 16 bytes, so the scalar after it packs into its 4th lane.
struct Frame {
    view: mat4x4f,             //   0
    proj: mat4x4f,             //  64
    view_proj: mat4x4f,        // 128
    inv_view_proj: mat4x4f,    // 192
    camera_pos: vec3f,         // 256
    time: f32,                 // 268
    sun_dir: vec3f,            // 272  unit vector toward the sun
    frame_index: u32,          // 284
    sun_color: vec3f,          // 288
    dt: f32,                   // 300
    sky_color: vec3f,          // 304
    fog_density: f32,          // 316
    fog_color: vec3f,          // 320
    fog_height_falloff: f32,   // 332
    ground_color: vec3f,       // 336
    fog_height: f32,           // 348
    resolution: vec2f,         // 352
    jitter: vec2f,             // 360
    exposure: f32,             // 368
    near_plane: f32,           // 372
    pad0: f32,
    pad1: f32,
}                              // 384 bytes

@group(0) @binding(0) var<uniform> frame: Frame;
