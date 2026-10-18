// frame_gpu: the Frame uniform buffer on the GPU and reversed-Z depth helpers (GPU module, chapter 03).
//
//   FrameGpu { buffer, layout, bind }   one uniform buffer + the shared group-0 layout and bind group
//   void frame_gpu_init(FrameGpu *f, Gpu *gpu)
//   void frame_gpu_upload(FrameGpu *f, Gpu *gpu, const FrameUniforms *u)   once per frame
//   void frame_gpu_release(FrameGpu *f)
//   DEPTH_FORMAT                         depth32float
//   WGPUTexture depth_texture(Gpu *gpu, uint32_t w, uint32_t h, WGPUTextureUsage extra)
//   WGPUDepthStencilState depth_state_rz(bool write)    compare Greater (reversed-Z), clear depth to 0
//   WGPURenderPassDepthStencilAttachment depth_attachment_rz(WGPUTextureView view)   clears to 0, stores
#pragma once
#include "frame.h"
#include "gpu.h"

#define DEPTH_FORMAT WGPUTextureFormat_Depth32Float

typedef struct FrameGpu {
    WGPUBuffer buffer;
    WGPUBindGroupLayout layout;   // shared by every pipeline as group 0: one bind group serves them all
    WGPUBindGroup bind;
} FrameGpu;

void frame_gpu_init(FrameGpu *f, Gpu *gpu);
void frame_gpu_upload(FrameGpu *f, Gpu *gpu, const FrameUniforms *u);
void frame_gpu_release(FrameGpu *f);

WGPUTexture depth_texture(Gpu *gpu, uint32_t width, uint32_t height, WGPUTextureUsage extra);
WGPUDepthStencilState depth_state_rz(bool write);
WGPURenderPassDepthStencilAttachment depth_attachment_rz(WGPUTextureView view);
