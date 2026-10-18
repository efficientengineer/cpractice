#include "frame_gpu.h"

void frame_gpu_init(FrameGpu *f, Gpu *gpu) {
    f->buffer = gpu_buffer(gpu, sizeof(FrameUniforms), WGPUBufferUsage_Uniform | WGPUBufferUsage_CopyDst, NULL, "frame");
    // An explicit layout (instead of each pipeline's "auto" layout) lets ONE bind group serve every pipeline.
    f->layout = wgpuDeviceCreateBindGroupLayout(gpu->device, &(WGPUBindGroupLayoutDescriptor){
        .label = SV("frame"), .entryCount = 1,
        .entries = &(WGPUBindGroupLayoutEntry){ .binding = 0,
            .visibility = WGPUShaderStage_Vertex | WGPUShaderStage_Fragment | WGPUShaderStage_Compute,
            .buffer = { .type = WGPUBufferBindingType_Uniform, .minBindingSize = sizeof(FrameUniforms) } } });
    f->bind = wgpuDeviceCreateBindGroup(gpu->device, &(WGPUBindGroupDescriptor){
        .label = SV("frame"), .layout = f->layout, .entryCount = 1,
        .entries = &(WGPUBindGroupEntry){ .binding = 0, .buffer = f->buffer, .size = sizeof(FrameUniforms) } });
}

void frame_gpu_upload(FrameGpu *f, Gpu *gpu, const FrameUniforms *u) {
    wgpuQueueWriteBuffer(gpu->queue, f->buffer, 0, u, sizeof *u);
}

void frame_gpu_release(FrameGpu *f) {
    if (f->bind) wgpuBindGroupRelease(f->bind);
    if (f->layout) wgpuBindGroupLayoutRelease(f->layout);
    if (f->buffer) { wgpuBufferDestroy(f->buffer); wgpuBufferRelease(f->buffer); }
    *f = (FrameGpu){0};
}

WGPUTexture depth_texture(Gpu *gpu, uint32_t width, uint32_t height, WGPUTextureUsage extra) {
    return wgpuDeviceCreateTexture(gpu->device, &(WGPUTextureDescriptor){
        .label = SV("depth"), .size = { width, height, 1 }, .format = DEPTH_FORMAT, .mipLevelCount = 1, .sampleCount = 1,
        .dimension = WGPUTextureDimension_2D, .usage = WGPUTextureUsage_RenderAttachment | extra });
}

// Reversed-Z: near is depth 1, far is 0. Clear to 0 and keep fragments with a GREATER depth.
WGPUDepthStencilState depth_state_rz(bool write) {
    return (WGPUDepthStencilState){
        .format = DEPTH_FORMAT,
        .depthWriteEnabled = write ? WGPUOptionalBool_True : WGPUOptionalBool_False,
        .depthCompare = WGPUCompareFunction_Greater,
        .stencilFront = { .compare = WGPUCompareFunction_Always, .failOp = WGPUStencilOperation_Keep,
                          .depthFailOp = WGPUStencilOperation_Keep, .passOp = WGPUStencilOperation_Keep },
        .stencilBack = { .compare = WGPUCompareFunction_Always, .failOp = WGPUStencilOperation_Keep,
                         .depthFailOp = WGPUStencilOperation_Keep, .passOp = WGPUStencilOperation_Keep },
        .stencilReadMask = 0xFFFFFFFFu, .stencilWriteMask = 0xFFFFFFFFu };
}

WGPURenderPassDepthStencilAttachment depth_attachment_rz(WGPUTextureView view) {
    return (WGPURenderPassDepthStencilAttachment){ .view = view, .depthLoadOp = WGPULoadOp_Clear,
        .depthStoreOp = WGPUStoreOp_Store, .depthClearValue = 0.0f };
}
