// frame.h: the per-frame uniform block shared by every pipeline (CPU module, chapter 03-terrain).
//
// FrameUniforms mirrors `struct Frame` in shaders/frame.wgsl byte for byte and is bound at
// @group(0) @binding(0) everywhere. It is filled on the CPU and uploaded with ONE
// wgpuQueueWriteBuffer per frame. Later chapters only append fields (keep the size a multiple
// of 16 and add the same fields to frame.wgsl).
//
//   FrameUniforms                                  384 bytes, WGSL uniform layout (see offsets)
//   void frame_defaults(FrameUniforms *f)          zeroes it; afternoon sun, sky/fog/ground colors, exposure 1
//   void frame_set_camera(FrameUniforms *f, mat4 view, mat4 proj, vec3 eye)
//                                                  view, proj, view_proj = proj * view, its inverse, camera_pos
//   void frame_set_sun(FrameUniforms *f, vec3 dir_to_sun)   normalizes
//   void frame_set_time(FrameUniforms *f, float time, float dt, uint32_t frame_index)
//   void frame_set_resolution(FrameUniforms *f, float width, float height)
#pragma once
#include "wmath.h"
#include <stddef.h>
#include <stdint.h>
#include <string.h>

// WGSL layout rules: mat4x4f is 64 bytes, aligned 16; vec3f is 12 bytes but aligned 16, so a
// scalar packs into the 4 bytes after it; vec2f is aligned 8. The C struct uses the same order
// and every field lands on the same offset (checked by the static asserts below).
typedef struct FrameUniforms {
    mat4 view;                 //   0
    mat4 proj;                 //  64
    mat4 view_proj;            // 128  proj * view
    mat4 inv_view_proj;        // 192  clip -> world (rebuild world positions from depth)
    vec3 camera_pos;           // 256
    float time;                // 268  seconds since start
    vec3 sun_dir;              // 272  unit vector TOWARD the sun
    uint32_t frame_index;      // 284
    vec3 sun_color;            // 288  linear radiance
    float dt;                  // 300  seconds since last frame
    vec3 sky_color;            // 304  ambient light from above (hemisphere top)
    float fog_density;         // 316  extinction per meter at fog_height
    vec3 fog_color;            // 320  in-scattered color of fog (horizon color)
    float fog_height_falloff;  // 332  1/meters: how fast fog thins with altitude
    vec3 ground_color;         // 336  ambient light from below (bounce)
    float fog_height;          // 348  altitude where density == fog_density
    vec2 resolution;           // 352  render target size in pixels
    vec2 jitter;               // 360  sub-pixel projection jitter in pixels (TAA, chapter 20)
    float exposure;            // 368  scene color multiplier before tone mapping
    float near_plane;          // 372  projection near plane (linearize reversed-Z: dist = near / depth)
    float pad0, pad1;          // 376
} FrameUniforms;               // 384

_Static_assert(sizeof(FrameUniforms) == 384, "FrameUniforms must match struct Frame in frame.wgsl");
_Static_assert(offsetof(FrameUniforms, camera_pos) == 256, "Frame layout");
_Static_assert(offsetof(FrameUniforms, sun_dir) == 272, "Frame layout");
_Static_assert(offsetof(FrameUniforms, resolution) == 352, "Frame layout");
_Static_assert(offsetof(FrameUniforms, exposure) == 368, "Frame layout");

static inline void frame_set_sun(FrameUniforms *f, vec3 dir_to_sun) {
    f->sun_dir = v3_norm(dir_to_sun);
}

// A clear afternoon. Chapter 21 drives these from a time of day.
static inline void frame_defaults(FrameUniforms *f) {
    memset(f, 0, sizeof *f);
    f->view = f->proj = f->view_proj = f->inv_view_proj = m4_identity();
    frame_set_sun(f, v3(0.45f, 0.55f, -0.70f));
    f->sun_color = v3(3.0f, 2.8f, 2.5f);
    f->sky_color = v3(0.30f, 0.50f, 0.90f);
    f->fog_color = v3(0.62f, 0.72f, 0.86f);
    f->ground_color = v3(0.18f, 0.15f, 0.12f);
    f->fog_density = 0.0006f;
    f->fog_height_falloff = 0.008f;
    f->fog_height = 0.0f;
    f->exposure = 1.0f;
    f->near_plane = 0.1f;
}

static inline void frame_set_camera(FrameUniforms *f, mat4 view, mat4 proj, vec3 eye) {
    f->view = view;
    f->proj = proj;
    f->view_proj = m4_mul(proj, view);
    if (!m4_inverse(f->view_proj, &f->inv_view_proj)) f->inv_view_proj = m4_identity();
    f->camera_pos = eye;
    // Reversed-Z (m4_perspective_rz): m[14] / (m[10] + 1) is the near plane, finite far or not.
    if (proj.m[11] == -1.0f) f->near_plane = proj.m[14] / (proj.m[10] + 1.0f);
}

static inline void frame_set_time(FrameUniforms *f, float time, float dt, uint32_t frame_index) {
    f->time = time;
    f->dt = dt;
    f->frame_index = frame_index;
}

static inline void frame_set_resolution(FrameUniforms *f, float width, float height) {
    f->resolution = v2(width, height);
}
