// Chapter 00: open a window and draw a procedural sky. The sun circles over time.
#include "app.h"
#include <math.h>
#include <stdio.h>

typedef struct { float resolution[2], time, pad, sun_dir[3], pad2; } SkyUniforms;

int main(void) {
    App app;
    if (!app_init(&app, "00 - sky", 1280, 720)) return 1;
    Gpu *gpu = &app.gpu;

    // Everything long-lived is created once, before the loop.
    WGPUShaderModule module = gpu_shader_file(gpu, "sky.wgsl");
    WGPURenderPipeline pipeline = wgpuDeviceCreateRenderPipeline(gpu->device, &(WGPURenderPipelineDescriptor){
        .label = SV("sky"),
        .vertex = { .module = module, .entryPoint = SV("vs") },
        .primitive = { .topology = WGPUPrimitiveTopology_TriangleList },
        .multisample = { .count = 1, .mask = ~0u },
        .fragment = &(WGPUFragmentState){ .module = module, .entryPoint = SV("fs"), .targetCount = 1,
            .targets = &(WGPUColorTargetState){ .format = gpu->format, .writeMask = WGPUColorWriteMask_All } },
    });
    WGPUBuffer ubo = gpu_buffer(gpu, sizeof(SkyUniforms), WGPUBufferUsage_Uniform | WGPUBufferUsage_CopyDst, NULL, "sky uniforms");
    WGPUBindGroup bind = wgpuDeviceCreateBindGroup(gpu->device, &(WGPUBindGroupDescriptor){
        .layout = wgpuRenderPipelineGetBindGroupLayout(pipeline, 0), .entryCount = 1,
        .entries = &(WGPUBindGroupEntry){ .binding = 0, .buffer = ubo, .size = sizeof(SkyUniforms) } });

    while (app_frame(&app)) {
        // Per frame: one small uniform write, one pass, no allocation.
        float a = (float)app.time * 0.2f;
        SkyUniforms u = { { (float)gpu->width, (float)gpu->height }, (float)app.time, 0,
                          { cosf(a) * 0.8f, 0.25f + 0.2f * sinf(a), -0.6f }, 0 };
        float len = sqrtf(u.sun_dir[0] * u.sun_dir[0] + u.sun_dir[1] * u.sun_dir[1] + u.sun_dir[2] * u.sun_dir[2]);
        for (int i = 0; i < 3; i++) u.sun_dir[i] /= len;
        wgpuQueueWriteBuffer(gpu->queue, ubo, 0, &u, sizeof u);

        WGPUTexture target = gpu_acquire(gpu);
        if (!target) continue;
        WGPUTextureView view = wgpuTextureCreateView(target, NULL);
        WGPUCommandEncoder enc = wgpuDeviceCreateCommandEncoder(gpu->device, NULL);
        WGPURenderPassEncoder pass = wgpuCommandEncoderBeginRenderPass(enc, &(WGPURenderPassDescriptor){
            .colorAttachmentCount = 1,
            .colorAttachments = &(WGPURenderPassColorAttachment){ .view = view, .depthSlice = WGPU_DEPTH_SLICE_UNDEFINED,
                .loadOp = WGPULoadOp_Clear, .storeOp = WGPUStoreOp_Store } });
        wgpuRenderPassEncoderSetPipeline(pass, pipeline);
        wgpuRenderPassEncoderSetBindGroup(pass, 0, bind, 0, NULL);
        wgpuRenderPassEncoderDraw(pass, 3, 1, 0, 0);
        wgpuRenderPassEncoderEnd(pass);
        WGPUCommandBuffer cb = wgpuCommandEncoderFinish(enc, NULL);
        wgpuQueueSubmit(gpu->queue, 1, &cb);
        wgpuCommandBufferRelease(cb);
        wgpuRenderPassEncoderRelease(pass);
        wgpuCommandEncoderRelease(enc);
        wgpuTextureViewRelease(view);
        gpu_present(gpu);
        wgpuTextureRelease(target);
    }
    app_shutdown(&app);
    return 0;
}
