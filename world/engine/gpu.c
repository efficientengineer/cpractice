#include "gpu.h"
#include "util.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifdef WORLD_WEBGPU_WGPU
#include <webgpu/wgpu.h>
#endif

static void print_sv(const char *prefix, WGPUStringView s) {
    fprintf(stderr, "%s%.*s\n", prefix, (int)(s.length == WGPU_STRLEN ? strlen(s.data) : s.length), s.data ? s.data : "");
}

// ---- blocking helpers: request, then poll until the callback has fired ----

typedef struct { int done; WGPUAdapter adapter; WGPUDevice device; } Req;

static void on_adapter(WGPURequestAdapterStatus status, WGPUAdapter adapter, WGPUStringView msg, void *u1, void *u2) {
    Req *r = u1;
    if (status != WGPURequestAdapterStatus_Success) print_sv("adapter request failed: ", msg);
    r->adapter = adapter; r->done = 1;
}
static void on_device(WGPURequestDeviceStatus status, WGPUDevice device, WGPUStringView msg, void *u1, void *u2) {
    Req *r = u1;
    if (status != WGPURequestDeviceStatus_Success) print_sv("device request failed: ", msg);
    r->device = device; r->done = 1;
}
static void on_error(const WGPUDevice *device, WGPUErrorType type, WGPUStringView msg, void *u1, void *u2) {
    Gpu *gpu = u1;
    gpu->errors++;
    print_sv("WebGPU error: ", msg);
}
static void on_lost(const WGPUDevice *device, WGPUDeviceLostReason reason, WGPUStringView msg, void *u1, void *u2) {
    if (reason != WGPUDeviceLostReason_Destroyed) print_sv("device lost: ", msg);
}

void gpu_poll(Gpu *gpu, bool wait) {
#ifdef WORLD_WEBGPU_WGPU
    if (gpu->device) wgpuDevicePoll(gpu->device, wait, NULL);
    else wgpuInstanceProcessEvents(gpu->instance);
#else
    (void)wait;
    wgpuInstanceProcessEvents(gpu->instance);
#endif
}

bool gpu_create_instance(Gpu *gpu) {
    memset(gpu, 0, sizeof *gpu);
    gpu->instance = wgpuCreateInstance(NULL);
    return gpu->instance != NULL;
}

bool gpu_init(Gpu *gpu, WGPUSurface surface) {
    if (!gpu->instance && !gpu_create_instance(gpu)) return false;
    gpu->surface = surface;
    Req r = {0};
    wgpuInstanceRequestAdapter(gpu->instance, &(WGPURequestAdapterOptions){
            .compatibleSurface = surface, .powerPreference = WGPUPowerPreference_HighPerformance },
        (WGPURequestAdapterCallbackInfo){ .mode = WGPUCallbackMode_AllowProcessEvents, .callback = on_adapter, .userdata1 = &r });
    while (!r.done) gpu_poll(gpu, true);
    if (!r.adapter) return false;
    gpu->adapter = r.adapter;

    WGPUAdapterInfo info = {0};
    wgpuAdapterGetInfo(gpu->adapter, &info);
    print_sv("GPU: ", info.device);
    wgpuAdapterInfoFreeMembers(info);

    // Ask for the adapter's real limits instead of the conservative defaults.
    WGPULimits limits = {0};
    wgpuAdapterGetLimits(gpu->adapter, &limits);
    r.done = 0;
    wgpuAdapterRequestDevice(gpu->adapter, &(WGPUDeviceDescriptor){
            .label = SV("world"),
            .requiredLimits = &limits,
            .uncapturedErrorCallbackInfo = { .callback = on_error, .userdata1 = gpu },
            .deviceLostCallbackInfo = { .mode = WGPUCallbackMode_AllowProcessEvents, .callback = on_lost } },
        (WGPURequestDeviceCallbackInfo){ .mode = WGPUCallbackMode_AllowProcessEvents, .callback = on_device, .userdata1 = &r });
    while (!r.done) gpu_poll(gpu, true);
    if (!r.device) return false;
    gpu->device = r.device;
    gpu->queue = wgpuDeviceGetQueue(gpu->device);
    gpu->format = WGPUTextureFormat_RGBA8Unorm;

    if (surface) {
        WGPUSurfaceCapabilities caps = {0};
        wgpuSurfaceGetCapabilities(surface, gpu->adapter, &caps);
        gpu->format = caps.formats[0];
        // Prefer a non-sRGB 8-bit format; the engine does its own tone mapping and encoding.
        for (size_t i = 0; i < caps.formatCount; i++)
            if (caps.formats[i] == WGPUTextureFormat_BGRA8Unorm || caps.formats[i] == WGPUTextureFormat_RGBA8Unorm) { gpu->format = caps.formats[i]; break; }
        wgpuSurfaceCapabilitiesFreeMembers(caps);
    }
    return true;
}

void gpu_shutdown(Gpu *gpu) {
    if (gpu->queue) wgpuQueueRelease(gpu->queue);
    if (gpu->device) { wgpuDeviceDestroy(gpu->device); wgpuDeviceRelease(gpu->device); }
    if (gpu->adapter) wgpuAdapterRelease(gpu->adapter);
    if (gpu->surface) wgpuSurfaceRelease(gpu->surface);
    if (gpu->instance) wgpuInstanceRelease(gpu->instance);
    memset(gpu, 0, sizeof *gpu);
}

void gpu_configure_surface(Gpu *gpu, uint32_t width, uint32_t height) {
    gpu->width = width; gpu->height = height;
    wgpuSurfaceConfigure(gpu->surface, &(WGPUSurfaceConfiguration){
        .device = gpu->device, .format = gpu->format, .usage = WGPUTextureUsage_RenderAttachment,
        .width = width, .height = height, .presentMode = WGPUPresentMode_Fifo, .alphaMode = WGPUCompositeAlphaMode_Auto });
}

WGPUTexture gpu_acquire(Gpu *gpu) {
    WGPUSurfaceTexture st = {0};
    wgpuSurfaceGetCurrentTexture(gpu->surface, &st);
    if (st.status == WGPUSurfaceGetCurrentTextureStatus_SuccessOptimal || st.status == WGPUSurfaceGetCurrentTextureStatus_SuccessSuboptimal)
        return st.texture;
    if (st.texture) wgpuTextureRelease(st.texture);
    // Outdated/lost (e.g. resize): reconfigure and skip this frame.
    gpu_configure_surface(gpu, gpu->width, gpu->height);
    return NULL;
}

void gpu_present(Gpu *gpu) {
    wgpuSurfacePresent(gpu->surface);
}

// ---- shaders ----

typedef struct { int done; } Wait;
static void on_compilation(WGPUCompilationInfoRequestStatus status, const WGPUCompilationInfo *info, void *u1, void *u2) {
    const char *label = u2;
    for (size_t i = 0; info && i < info->messageCount; i++) {
        const WGPUCompilationMessage *m = &info->messages[i];
        fprintf(stderr, "%s:%llu:%llu: %s: %.*s\n", label, (unsigned long long)m->lineNum, (unsigned long long)m->linePos,
                m->type == WGPUCompilationMessageType_Error ? "error" : m->type == WGPUCompilationMessageType_Warning ? "warning" : "info",
                (int)(m->message.length == WGPU_STRLEN ? strlen(m->message.data) : m->message.length), m->message.data);
    }
    ((Wait *)u1)->done = 1;
}

WGPUShaderModule gpu_shader(Gpu *gpu, const char *wgsl, const char *label) {
    WGPUShaderSourceWGSL src = { .chain.sType = WGPUSType_ShaderSourceWGSL, .code = SV(wgsl) };
    WGPUShaderModule m = wgpuDeviceCreateShaderModule(gpu->device, &(WGPUShaderModuleDescriptor){ .nextInChain = &src.chain, .label = SV(label) });
#ifndef WORLD_WEBGPU_WGPU
    // Dawn reports line-accurate compile messages; wgpu-native reports errors through the error callback.
    Wait w = {0};
    wgpuShaderModuleGetCompilationInfo(m, (WGPUCompilationInfoCallbackInfo){
        .mode = WGPUCallbackMode_AllowProcessEvents, .callback = on_compilation, .userdata1 = &w, .userdata2 = (void *)label });
    while (!w.done) gpu_poll(gpu, true);
#else
    (void)on_compilation;
#endif
    return m;
}

WGPUShaderModule gpu_shader_file(Gpu *gpu, const char *name) {
    char path[1024];
    snprintf(path, sizeof path, "%s%s", WORLD_SHADER_DIR, name);
    char *src = read_file(path, NULL);
    if (!src) { fprintf(stderr, "cannot read shader %s\n", path); return NULL; }
    WGPUShaderModule m = gpu_shader(gpu, src, name);
    free(src);
    return m;
}

// ---- buffers and readback ----

WGPUBuffer gpu_buffer(Gpu *gpu, uint64_t size, WGPUBufferUsage usage, const void *data, const char *label) {
    WGPUBuffer b = wgpuDeviceCreateBuffer(gpu->device, &(WGPUBufferDescriptor){
        .label = SV(label), .size = (size + 3) & ~3ull, .usage = usage | (data ? WGPUBufferUsage_CopyDst : 0) });
    if (data) wgpuQueueWriteBuffer(gpu->queue, b, 0, data, size);
    return b;
}

static void on_map(WGPUMapAsyncStatus status, WGPUStringView msg, void *u1, void *u2) {
    if (status != WGPUMapAsyncStatus_Success) print_sv("map failed: ", msg);
    *(int *)u1 = status == WGPUMapAsyncStatus_Success ? 1 : -1;
}

static bool map_and_copy(Gpu *gpu, WGPUBuffer rb, uint64_t size, void *dst) {
    int done = 0;
    wgpuBufferMapAsync(rb, WGPUMapMode_Read, 0, size, (WGPUBufferMapCallbackInfo){
        .mode = WGPUCallbackMode_AllowProcessEvents, .callback = on_map, .userdata1 = &done });
    while (!done) gpu_poll(gpu, true);
    if (done > 0) {
        memcpy(dst, wgpuBufferGetConstMappedRange(rb, 0, size), size);
        wgpuBufferUnmap(rb);
    }
    return done > 0;
}

bool gpu_read_buffer(Gpu *gpu, WGPUBuffer src, uint64_t offset, uint64_t size, void *dst) {
    WGPUBuffer rb = gpu_buffer(gpu, size, WGPUBufferUsage_MapRead | WGPUBufferUsage_CopyDst, NULL, "readback");
    WGPUCommandEncoder enc = wgpuDeviceCreateCommandEncoder(gpu->device, NULL);
    wgpuCommandEncoderCopyBufferToBuffer(enc, src, offset, rb, 0, size);
    WGPUCommandBuffer cb = wgpuCommandEncoderFinish(enc, NULL);
    wgpuQueueSubmit(gpu->queue, 1, &cb);
    wgpuCommandBufferRelease(cb);
    wgpuCommandEncoderRelease(enc);
    bool ok = map_and_copy(gpu, rb, size, dst);
    wgpuBufferDestroy(rb);
    wgpuBufferRelease(rb);
    return ok;
}

bool gpu_read_texture_rgba8(Gpu *gpu, WGPUTexture tex, uint32_t width, uint32_t height, uint8_t *dst) {
    uint32_t bpr = (width * 4 + 255) & ~255u;   // bytesPerRow must be a multiple of 256
    uint64_t size = (uint64_t)bpr * height;
    WGPUBuffer rb = gpu_buffer(gpu, size, WGPUBufferUsage_MapRead | WGPUBufferUsage_CopyDst, NULL, "readback");
    WGPUCommandEncoder enc = wgpuDeviceCreateCommandEncoder(gpu->device, NULL);
    wgpuCommandEncoderCopyTextureToBuffer(enc,
        &(WGPUTexelCopyTextureInfo){ .texture = tex },
        &(WGPUTexelCopyBufferInfo){ .buffer = rb, .layout = { .bytesPerRow = bpr, .rowsPerImage = height } },
        &(WGPUExtent3D){ width, height, 1 });
    WGPUCommandBuffer cb = wgpuCommandEncoderFinish(enc, NULL);
    wgpuQueueSubmit(gpu->queue, 1, &cb);
    wgpuCommandBufferRelease(cb);
    wgpuCommandEncoderRelease(enc);
    uint8_t *tmp = malloc(size);
    bool ok = map_and_copy(gpu, rb, size, tmp);
    for (uint32_t y = 0; ok && y < height; y++) memcpy(dst + (size_t)y * width * 4, tmp + (size_t)y * bpr, (size_t)width * 4);
    free(tmp);
    wgpuBufferDestroy(rb);
    wgpuBufferRelease(rb);
    return ok;
}
