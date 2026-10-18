// wmath.h: small vector and matrix math for the engine (CPU module, chapter 03-terrain).
//
// Conventions: meters, right-handed, Y up, the camera looks down -Z in view space. mat4 is
// column-major (m[col * 4 + row]), the same memory layout as WGSL mat4x4f, so a mat4 can be
// copied straight into a uniform buffer. Clip depth is 0..1 and REVERSED: near -> 1, far -> 0.
// Everything is passed and returned by value: these are tiny structs the compiler keeps in
// registers, and pure functions are easy to test.
//
//   float wm_clamp(x, lo, hi)  wm_lerp(a, b, t)  wm_radians(deg)  wm_smooth01(t)
//   vec2 v2(x, y)    vec3 v3(x, y, z)    vec4 v4(x, y, z, w)
//   vec3 v3_add(a, b) v3_sub(a, b) v3_mul(a, b) v3_scale(a, s) v3_mad(a, b, s) = a + b * s  v3_neg(a)
//   float v3_dot(a, b) v3_len(a) v3_len2(a) v3_dist(a, b)    vec3 v3_cross(a, b) v3_norm(a) v3_lerp(a, b, t)
//   mat4 m4_identity()  m4_mul(a, b) (apply b first)  m4_translation(t)  m4_scaling(s)
//        m4_rotation_x(rad)  m4_rotation_y(rad)  m4_transpose(m)
//   vec4 m4_mul_v4(m, v)    vec3 m4_point(m, p) (w = 1, perspective divide)    vec3 m4_dir(m, d) (w = 0)
//   mat4 m4_perspective_rz(fovy, aspect, near_z, far_z)  reversed-Z; far_z = INFINITY: no far plane
//   mat4 m4_look_at(eye, target, up)                   view matrix
//   bool m4_inverse(m, mat4 *out)                      false if singular
//   vec3 orbit_eye(target, yaw, pitch, dist)           eye of an orbit camera (yaw 0: eye on +Z side)
#pragma once
#include <math.h>
#include <stdbool.h>

#define WM_PI 3.14159265358979323846f

typedef struct vec2 { float x, y; } vec2;
typedef struct vec3 { float x, y, z; } vec3;
typedef struct vec4 { float x, y, z, w; } vec4;
typedef struct mat4 { float m[16]; } mat4;   // column-major: m[col * 4 + row]

static inline float wm_clamp(float x, float lo, float hi) { return x < lo ? lo : x > hi ? hi : x; }
static inline float wm_lerp(float a, float b, float t) { return a + (b - a) * t; }
static inline float wm_radians(float deg) { return deg * (WM_PI / 180.0f); }
static inline float wm_smooth01(float t) { t = wm_clamp(t, 0.0f, 1.0f); return t * t * (3.0f - 2.0f * t); }

static inline vec2 v2(float x, float y) { return (vec2){ x, y }; }
static inline vec3 v3(float x, float y, float z) { return (vec3){ x, y, z }; }
static inline vec4 v4(float x, float y, float z, float w) { return (vec4){ x, y, z, w }; }

static inline vec3 v3_add(vec3 a, vec3 b) { return v3(a.x + b.x, a.y + b.y, a.z + b.z); }
static inline vec3 v3_sub(vec3 a, vec3 b) { return v3(a.x - b.x, a.y - b.y, a.z - b.z); }
static inline vec3 v3_mul(vec3 a, vec3 b) { return v3(a.x * b.x, a.y * b.y, a.z * b.z); }
static inline vec3 v3_scale(vec3 a, float s) { return v3(a.x * s, a.y * s, a.z * s); }
static inline vec3 v3_mad(vec3 a, vec3 b, float s) { return v3(a.x + b.x * s, a.y + b.y * s, a.z + b.z * s); }
static inline vec3 v3_neg(vec3 a) { return v3(-a.x, -a.y, -a.z); }
static inline float v3_dot(vec3 a, vec3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
static inline float v3_len2(vec3 a) { return v3_dot(a, a); }
static inline float v3_len(vec3 a) { return sqrtf(v3_dot(a, a)); }
static inline float v3_dist(vec3 a, vec3 b) { return v3_len(v3_sub(a, b)); }
static inline vec3 v3_cross(vec3 a, vec3 b) {
    return v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}
// Zero stays zero instead of becoming NaN.
static inline vec3 v3_norm(vec3 a) {
    float l = v3_len(a);
    return l > 0.0f ? v3_scale(a, 1.0f / l) : a;
}
static inline vec3 v3_lerp(vec3 a, vec3 b, float t) { return v3_mad(a, v3_sub(b, a), t); }

static inline mat4 m4_identity(void) {
    return (mat4){ { 1, 0, 0, 0,  0, 1, 0, 0,  0, 0, 1, 0,  0, 0, 0, 1 } };
}

// (a * b) * v == a * (b * v): b is applied first.
static inline mat4 m4_mul(mat4 a, mat4 b) {
    mat4 r;
    for (int c = 0; c < 4; c++)
        for (int row = 0; row < 4; row++)
            r.m[c * 4 + row] = a.m[0 * 4 + row] * b.m[c * 4 + 0] + a.m[1 * 4 + row] * b.m[c * 4 + 1]
                             + a.m[2 * 4 + row] * b.m[c * 4 + 2] + a.m[3 * 4 + row] * b.m[c * 4 + 3];
    return r;
}

static inline vec4 m4_mul_v4(mat4 m, vec4 v) {
    const float *a = m.m;
    return v4(a[0] * v.x + a[4] * v.y + a[8] * v.z + a[12] * v.w,
              a[1] * v.x + a[5] * v.y + a[9] * v.z + a[13] * v.w,
              a[2] * v.x + a[6] * v.y + a[10] * v.z + a[14] * v.w,
              a[3] * v.x + a[7] * v.y + a[11] * v.z + a[15] * v.w);
}
static inline vec3 m4_point(mat4 m, vec3 p) {
    vec4 r = m4_mul_v4(m, v4(p.x, p.y, p.z, 1.0f));
    return v3(r.x / r.w, r.y / r.w, r.z / r.w);
}
static inline vec3 m4_dir(mat4 m, vec3 d) {
    vec4 r = m4_mul_v4(m, v4(d.x, d.y, d.z, 0.0f));
    return v3(r.x, r.y, r.z);
}

static inline mat4 m4_translation(vec3 t) {
    mat4 r = m4_identity();
    r.m[12] = t.x; r.m[13] = t.y; r.m[14] = t.z;
    return r;
}
static inline mat4 m4_scaling(vec3 s) {
    mat4 r = m4_identity();
    r.m[0] = s.x; r.m[5] = s.y; r.m[10] = s.z;
    return r;
}
// Right-handed: positive angles turn counter-clockwise looking down the axis toward the origin.
static inline mat4 m4_rotation_x(float a) {
    mat4 r = m4_identity();
    float c = cosf(a), s = sinf(a);
    r.m[5] = c; r.m[6] = s; r.m[9] = -s; r.m[10] = c;
    return r;
}
static inline mat4 m4_rotation_y(float a) {
    mat4 r = m4_identity();
    float c = cosf(a), s = sinf(a);
    r.m[0] = c; r.m[2] = -s; r.m[8] = s; r.m[10] = c;
    return r;
}
static inline mat4 m4_transpose(mat4 m) {
    mat4 r;
    for (int c = 0; c < 4; c++)
        for (int row = 0; row < 4; row++) r.m[c * 4 + row] = m.m[row * 4 + c];
    return r;
}

// Reversed-Z perspective (WebGPU clip depth 0..1). Floats are densest near 0; the 1/z depth
// mapping crowds precision near the camera. Mapping near -> 1 and far -> 0 makes the two cancel,
// so depth stays precise at 10 km (Reed 2015, "Depth Precision Visualized").
//   clip.z = A * z + B, clip.w = -z, depth = clip.z / clip.w
//   finite far:   A = near / (far - near), B = far * near / (far - near)   z = -near -> 1, z = -far -> 0
//   infinite far: A = 0, B = near                                         depth = near / distance
static inline mat4 m4_perspective_rz(float fovy, float aspect, float near_z, float far_z) {
    float f = 1.0f / tanf(fovy * 0.5f);
    mat4 r = { { 0 } };
    r.m[0] = f / aspect;
    r.m[5] = f;
    r.m[11] = -1.0f;
    if (isinf(far_z)) { r.m[10] = 0.0f; r.m[14] = near_z; }
    else { r.m[10] = near_z / (far_z - near_z); r.m[14] = far_z * near_z / (far_z - near_z); }
    return r;
}

// View matrix: its rows are the camera's right, up and back (+Z) axes; the translation moves the
// eye to the origin. up must not be parallel to target - eye.
static inline mat4 m4_look_at(vec3 eye, vec3 target, vec3 up) {
    vec3 z = v3_norm(v3_sub(eye, target));      // back
    vec3 x = v3_norm(v3_cross(up, z));          // right
    vec3 y = v3_cross(z, x);                    // up
    return (mat4){ { x.x, y.x, z.x, 0,
                     x.y, y.y, z.y, 0,
                     x.z, y.z, z.z, 0,
                     -v3_dot(x, eye), -v3_dot(y, eye), -v3_dot(z, eye), 1 } };
}

// General 4x4 inverse by cofactors (2x2 sub-determinants shared between terms).
static inline bool m4_inverse(mat4 m, mat4 *out) {
    const float *a = m.m;
    float b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4];
    float b02 = a[0] * a[7] - a[3] * a[4], b03 = a[1] * a[6] - a[2] * a[5];
    float b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6];
    float b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12];
    float b08 = a[8] * a[15] - a[11] * a[12], b09 = a[9] * a[14] - a[10] * a[13];
    float b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
    float det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (det == 0.0f || !isfinite(det)) return false;
    float d = 1.0f / det;
    float *o = out->m;
    o[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * d;
    o[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * d;
    o[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * d;
    o[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * d;
    o[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * d;
    o[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * d;
    o[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * d;
    o[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * d;
    o[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * d;
    o[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * d;
    o[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * d;
    o[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * d;
    o[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * d;
    o[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * d;
    o[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * d;
    o[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * d;
    return true;
}

// Orbit camera: the eye sits dist away from target. yaw turns around +Y (0: eye on the +Z side,
// looking toward -Z), pitch > 0 lifts the eye above the target (looking down).
static inline vec3 orbit_eye(vec3 target, float yaw, float pitch, float dist) {
    float cp = cosf(pitch);
    return v3(target.x + sinf(yaw) * cp * dist, target.y + sinf(pitch) * dist, target.z + cosf(yaw) * cp * dist);
}
