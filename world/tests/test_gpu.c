// Headless GPU tests: no window; render or compute into textures/buffers and read them back.
#include "test.h"
#include "gpu.h"
#include <stdlib.h>
#include <string.h>

static Gpu *shared_gpu(void) {
    static Gpu gpu;
    static bool ready;
    if (!ready) { ready = gpu_init(&gpu, NULL); if (!ready) { printf("no GPU\n"); exit(1); } }
    return &gpu;
}

TEST(gpu_compute_squares) {
    Gpu *gpu = shared_gpu();
    WGPUShaderModule m = gpu_shader(gpu,
        "@group(0) @binding(0) var<storage, read_write> o: array<u32>;\n"
        "@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) i: vec3u) { o[i.x] = i.x * i.x; }\n", "squares");
    WGPUComputePipeline pl = wgpuDeviceCreateComputePipeline(gpu->device, &(WGPUComputePipelineDescriptor){ .compute = { .module = m, .entryPoint = SV("main") } });
    WGPUBuffer buf = gpu_buffer(gpu, 256, WGPUBufferUsage_Storage | WGPUBufferUsage_CopySrc, NULL, "out");
    WGPUBindGroup bg = wgpuDeviceCreateBindGroup(gpu->device, &(WGPUBindGroupDescriptor){ .layout = wgpuComputePipelineGetBindGroupLayout(pl, 0),
        .entryCount = 1, .entries = &(WGPUBindGroupEntry){ .binding = 0, .buffer = buf, .size = 256 } });
    WGPUCommandEncoder enc = wgpuDeviceCreateCommandEncoder(gpu->device, NULL);
    WGPUComputePassEncoder pass = wgpuCommandEncoderBeginComputePass(enc, NULL);
    wgpuComputePassEncoderSetPipeline(pass, pl);
    wgpuComputePassEncoderSetBindGroup(pass, 0, bg, 0, NULL);
    wgpuComputePassEncoderDispatchWorkgroups(pass, 1, 1, 1);
    wgpuComputePassEncoderEnd(pass);
    WGPUCommandBuffer cb = wgpuCommandEncoderFinish(enc, NULL);
    wgpuQueueSubmit(gpu->queue, 1, &cb);
    uint32_t out[64];
    CHECK(gpu_read_buffer(gpu, buf, 0, sizeof out, out));
    CHECK(out[0] == 0 && out[7] == 49 && out[63] == 3969);
    CHECK(gpu->errors == 0);
}

TEST(gpu_sky_renders) {
    Gpu *gpu = shared_gpu();
    const uint32_t W = 64, H = 64;
    WGPUTexture tex = wgpuDeviceCreateTexture(gpu->device, &(WGPUTextureDescriptor){
        .size = { W, H, 1 }, .format = WGPUTextureFormat_RGBA8Unorm, .mipLevelCount = 1, .sampleCount = 1, .dimension = WGPUTextureDimension_2D,
        .usage = WGPUTextureUsage_RenderAttachment | WGPUTextureUsage_CopySrc });
    WGPUShaderModule m = gpu_shader_file(gpu, "sky.wgsl");
    WGPURenderPipeline pl = wgpuDeviceCreateRenderPipeline(gpu->device, &(WGPURenderPipelineDescriptor){
        .vertex = { .module = m, .entryPoint = SV("vs") },
        .primitive = { .topology = WGPUPrimitiveTopology_TriangleList }, .multisample = { .count = 1, .mask = ~0u },
        .fragment = &(WGPUFragmentState){ .module = m, .entryPoint = SV("fs"), .targetCount = 1,
            .targets = &(WGPUColorTargetState){ .format = WGPUTextureFormat_RGBA8Unorm, .writeMask = WGPUColorWriteMask_All } } });
    float u[8] = { (float)W, (float)H, 0, 0, 0.7f, 0.1f, -0.7f, 0 };   // sun off to the right
    WGPUBuffer ubo = gpu_buffer(gpu, sizeof u, WGPUBufferUsage_Uniform, u, "sky");
    WGPUBindGroup bg = wgpuDeviceCreateBindGroup(gpu->device, &(WGPUBindGroupDescriptor){ .layout = wgpuRenderPipelineGetBindGroupLayout(pl, 0),
        .entryCount = 1, .entries = &(WGPUBindGroupEntry){ .binding = 0, .buffer = ubo, .size = sizeof u } });
    WGPUTextureView view = wgpuTextureCreateView(tex, NULL);
    WGPUCommandEncoder enc = wgpuDeviceCreateCommandEncoder(gpu->device, NULL);
    WGPURenderPassEncoder pass = wgpuCommandEncoderBeginRenderPass(enc, &(WGPURenderPassDescriptor){ .colorAttachmentCount = 1,
        .colorAttachments = &(WGPURenderPassColorAttachment){ .view = view, .depthSlice = WGPU_DEPTH_SLICE_UNDEFINED, .loadOp = WGPULoadOp_Clear, .storeOp = WGPUStoreOp_Store } });
    wgpuRenderPassEncoderSetPipeline(pass, pl);
    wgpuRenderPassEncoderSetBindGroup(pass, 0, bg, 0, NULL);
    wgpuRenderPassEncoderDraw(pass, 3, 1, 0, 0);
    wgpuRenderPassEncoderEnd(pass);
    WGPUCommandBuffer cb = wgpuCommandEncoderFinish(enc, NULL);
    wgpuQueueSubmit(gpu->queue, 1, &cb);
    uint8_t px[64 * 64 * 4];
    CHECK(gpu_read_texture_rgba8(gpu, tex, W, H, px));
    const uint8_t *top = px + (2 * W + 32) * 4, *bottom = px + (60 * W + 32) * 4;
    CHECK(top[2] > top[0]);          // sky is blue at the top
    CHECK(bottom[2] <= bottom[0] + 10); // ground is brownish at the bottom
    CHECK(gpu->errors == 0);
}
