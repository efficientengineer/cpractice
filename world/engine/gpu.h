// GPU core: instance/adapter/device setup, blocking helpers for async WebGPU calls,
// shader loading, buffer readback. Works with Dawn and wgpu-native (same webgpu.h).
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <webgpu/webgpu.h>

#define SV(s) ((WGPUStringView){ (s), WGPU_STRLEN })

typedef struct Gpu {
    WGPUInstance instance;
    WGPUAdapter adapter;
    WGPUDevice device;
    WGPUQueue queue;
    WGPUSurface surface;          // NULL when headless
    WGPUTextureFormat format;     // surface format (or RGBA8Unorm headless)
    uint32_t width, height;       // surface size in pixels
    int errors;                   // validation errors seen so far (tests assert 0)
} Gpu;

// Creates instance, adapter and device. surface may be NULL (headless: tests, tools).
// The surface must have been created from gpu->instance (see gpu_create_instance).
bool gpu_create_instance(Gpu *gpu);
bool gpu_init(Gpu *gpu, WGPUSurface surface);
void gpu_shutdown(Gpu *gpu);

// Lets the implementation run callbacks (map, adapter, errors). Dawn and wgpu-native differ here.
void gpu_poll(Gpu *gpu, bool wait);

// Surface (window) handling.
void gpu_configure_surface(Gpu *gpu, uint32_t width, uint32_t height);
// Returns the texture to render into this frame, or NULL if the frame should be skipped.
WGPUTexture gpu_acquire(Gpu *gpu);
void gpu_present(Gpu *gpu);

// Shaders: from a string, or from shaders/NAME (WORLD_SHADER_DIR). Compile errors are printed.
WGPUShaderModule gpu_shader(Gpu *gpu, const char *wgsl, const char *label);
WGPUShaderModule gpu_shader_file(Gpu *gpu, const char *name);

WGPUBuffer gpu_buffer(Gpu *gpu, uint64_t size, WGPUBufferUsage usage, const void *data, const char *label);
// Copies size bytes of src into dst (blocking). For tests and tools only, never per frame.
bool gpu_read_buffer(Gpu *gpu, WGPUBuffer src, uint64_t offset, uint64_t size, void *dst);
// Reads an RGBA8 texture (needs CopySrc usage) into width*height*4 bytes. Tests and tools only.
bool gpu_read_texture_rgba8(Gpu *gpu, WGPUTexture tex, uint32_t width, uint32_t height, uint8_t *dst);
