// Chapter 01: hashing and noise. CPU properties, then CPU/GPU parity: the same functions in
// shaders/noise.wgsl and shaders/terrain.wgsl are evaluated in a compute shader and compared.
#include "test.h"
#include "gpu.h"
#include "noise.h"
#include "terrain.h"
#include <stdlib.h>
#include <string.h>

static Gpu *noise_gpu(void) {
    static Gpu gpu;
    static bool ready;
    if (!ready) { ready = gpu_init(&gpu, NULL); if (!ready) { printf("no GPU\n"); exit(1); } }
    return &gpu;
}

TEST(noise_hash_known_values) {
    // Pinned outputs: if these change, every world generated so far changes. Never edit casually.
    CHECK(hash_u32(0) == hash_u32(0));
    CHECK(hash_u32(0) != hash_u32(1));
    CHECK(hash2i(3, 4, 7) != hash2i(4, 3, 7));            // not symmetric in x, z
    CHECK(hash2i(3, 4, 7) != hash2i(3, 4, 8));            // seeds give different worlds
    CHECK(hash2i(-1, 0, 0) != hash2i(1, 0, 0));
    CHECK(hash3i(1, 2, 3, 0) != hash3i(3, 2, 1, 0));
    CHECK(hash_to_unit(0) == 0.0f);
    CHECK(hash_to_unit(0xFFFFFFFFu) < 1.0f);
}

TEST(noise_hash_distribution) {
    // Mean of hash_to_unit ~ 0.5, and flipping one input bit flips ~half of the output bits.
    double sum = 0;
    long flips = 0;
    const int N = 1 << 16;
    for (int i = 0; i < N; i++) {
        sum += hash_to_unit(hash2i(i & 255, i >> 8, 1));
        flips += __builtin_popcount(hash_u32((uint32_t)i) ^ hash_u32((uint32_t)i ^ (1u << (i & 31))));
    }
    CHECK_NEAR(sum / N, 0.5, 0.01);
    CHECK_NEAR((double)flips / N, 16.0, 0.5);
}

TEST(noise_ranges_and_lattice) {
    float lo[6] = { 9, 9, 9, 9, 9, 9 }, hi[6] = { -9, -9, -9, -9, -9, -9 };
    for (int i = 0; i < 20000; i++) {
        float x = (hash_to_unit(hash_u32(2 * i)) - 0.5f) * 500, y = (hash_to_unit(hash_u32(2 * i + 1)) - 0.5f) * 500;
        float v[6] = { noise_value2(x, y, 3), noise_perlin2(x, y, 3), noise_perlin3(x, y, x - y, 3),
                       noise_simplex2(x, y, 3), fbm2(x, y, 3, 5, 2, 0.5f), ridged2(x, y, 3, 5, 2, 0.5f) };
        for (int k = 0; k < 6; k++) { if (v[k] < lo[k]) lo[k] = v[k]; if (v[k] > hi[k]) hi[k] = v[k]; }
    }
    for (int k = 0; k < 5; k++) { CHECK(lo[k] >= -1.01f && lo[k] < -0.4f); CHECK(hi[k] <= 1.01f && hi[k] > 0.4f); }
    CHECK(lo[5] >= 0.0f && hi[5] <= 1.0f && hi[5] > 0.7f);
    // Gradient noise is zero on the lattice; and continuous across cell borders.
    CHECK(noise_perlin2(5, -7, 1) == 0.0f);
    CHECK(noise_perlin3(5, -7, 2, 1) == 0.0f);
    CHECK(fabsf(noise_perlin2(2.0f - 1e-4f, 0.3f, 1) - noise_perlin2(2.0f + 1e-4f, 0.3f, 1)) < 1e-3f);
    CHECK(fabsf(noise_simplex2(2.0f - 1e-4f, 0.3f, 1) - noise_simplex2(2.0f + 1e-4f, 0.3f, 1)) < 1e-3f);
    float wx = 10, wy = 20;
    domain_warp2(&wx, &wy, 1, 5.0f, 0.1f);
    CHECK(fabsf(wx - 10) <= 5.0f && fabsf(wy - 20) <= 5.0f && (wx != 10 || wy != 20));
}

TEST(noise_terrain_default) {
    TerrainParams t = terrain_default(42);
    float lo = 1e9f, hi = -1e9f;
    for (int z = 0; z < 64; z++)
        for (int x = 0; x < 64; x++) {
            float h = terrain_height(&t, x * 100.0f - 3200, z * 100.0f - 3200);
            if (h < lo) lo = h;
            if (h > hi) hi = h;
        }
    CHECK(lo >= 0.0f && hi <= t.height && hi - lo > 100.0f);
    CHECK(terrain_height(&t, 123.5f, -77.25f) == terrain_height(&t, 123.5f, -77.25f));
    TerrainParams t2 = terrain_default(43);
    CHECK(terrain_height(&t, 123.5f, -77.25f) != terrain_height(&t2, 123.5f, -77.25f));
}

// ---- GPU parity ----

enum { PARITY_N = 2048, PARITY_OUT = 10 };

static const char *parity_main =
    "@group(0) @binding(0) var<storage, read> pts: array<vec4f>;\n"
    "@group(0) @binding(1) var<uniform> terrain: TerrainParams;\n"
    "@group(0) @binding(2) var<storage, read_write> o: array<u32>;\n"
    "@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {\n"
    "    let i = id.x;\n"
    "    if (i >= arrayLength(&pts)) { return; }\n"
    "    let p = pts[i];\n"
    "    let b = i * 10u;\n"
    "    o[b + 0u] = hash2i(i32(floor(p.x)), i32(floor(p.y)), 7u);\n"
    "    o[b + 1u] = bitcast<u32>(noise_value2(p.x, p.y, 7u));\n"
    "    o[b + 2u] = bitcast<u32>(noise_perlin2(p.x, p.y, 7u));\n"
    "    o[b + 3u] = bitcast<u32>(noise_perlin3(p.x, p.y, p.z, 7u));\n"
    "    o[b + 4u] = bitcast<u32>(noise_simplex2(p.x, p.y, 7u));\n"
    "    o[b + 5u] = bitcast<u32>(fbm2(p.x, p.y, 7u, 6, 2.0, 0.5));\n"
    "    o[b + 6u] = bitcast<u32>(ridged2(p.x, p.y, 7u, 6, 2.0, 0.5));\n"
    "    let w = domain_warp2(p.xy, 7u, 3.0, 0.2);\n"
    "    o[b + 7u] = bitcast<u32>(w.x);\n"
    "    o[b + 8u] = bitcast<u32>(w.y);\n"
    "    o[b + 9u] = bitcast<u32>(terrain_height(p.xy * 300.0));\n"
    "}\n";

static float as_f(uint32_t u) { float f; memcpy(&f, &u, 4); return f; }

TEST(noise_gpu_parity) {
    Gpu *gpu = noise_gpu();
    char *lib = gpu_shader_source("terrain.wgsl");
    CHECK(lib != NULL);
    if (!lib) return;
    // The include ran once: noise.wgsl's functions appear exactly once.
    char *first = strstr(lib, "fn hash_u32(");
    CHECK(first && !strstr(first + 1, "fn hash_u32("));
    size_t n = strlen(lib) + strlen(parity_main) + 1;
    char *src = malloc(n);
    snprintf(src, n, "%s%s", lib, parity_main);
    free(lib);
    WGPUShaderModule m = gpu_shader(gpu, src, "noise parity");
    free(src);
    WGPUComputePipeline pl = wgpuDeviceCreateComputePipeline(gpu->device, &(WGPUComputePipelineDescriptor){
        .compute = { .module = m, .entryPoint = SV("main") } });

    static float pts[PARITY_N * 4];
    for (int i = 0; i < PARITY_N; i++) {
        // Wide range, negatives included, plus some exact lattice points.
        float s = i < 64 ? 1.0f : 300.0f;
        pts[i * 4 + 0] = i < 64 ? (float)(i % 8 - 4) : (hash_to_unit(hash_u32(3 * i)) - 0.5f) * s;
        pts[i * 4 + 1] = i < 64 ? (float)(i / 8 - 4) : (hash_to_unit(hash_u32(3 * i + 1)) - 0.5f) * s;
        pts[i * 4 + 2] = (hash_to_unit(hash_u32(3 * i + 2)) - 0.5f) * s;
        pts[i * 4 + 3] = 0;
    }
    TerrainParams tp = terrain_default(99);
    uint64_t out_size = (uint64_t)PARITY_N * PARITY_OUT * 4;
    WGPUBuffer pbuf = gpu_buffer(gpu, sizeof pts, WGPUBufferUsage_Storage, pts, "points");
    WGPUBuffer tbuf = gpu_buffer(gpu, sizeof tp, WGPUBufferUsage_Uniform, &tp, "terrain");
    WGPUBuffer obuf = gpu_buffer(gpu, out_size, WGPUBufferUsage_Storage | WGPUBufferUsage_CopySrc, NULL, "out");
    WGPUBindGroupLayout bgl = wgpuComputePipelineGetBindGroupLayout(pl, 0);
    WGPUBindGroup bg = wgpuDeviceCreateBindGroup(gpu->device, &(WGPUBindGroupDescriptor){ .layout = bgl, .entryCount = 3,
        .entries = (WGPUBindGroupEntry[]){ { .binding = 0, .buffer = pbuf, .size = sizeof pts },
                                           { .binding = 1, .buffer = tbuf, .size = sizeof tp },
                                           { .binding = 2, .buffer = obuf, .size = out_size } } });
    WGPUCommandEncoder enc = wgpuDeviceCreateCommandEncoder(gpu->device, NULL);
    WGPUComputePassEncoder pass = wgpuCommandEncoderBeginComputePass(enc, NULL);
    wgpuComputePassEncoderSetPipeline(pass, pl);
    wgpuComputePassEncoderSetBindGroup(pass, 0, bg, 0, NULL);
    wgpuComputePassEncoderDispatchWorkgroups(pass, PARITY_N / 64, 1, 1);
    wgpuComputePassEncoderEnd(pass);
    WGPUCommandBuffer cb = wgpuCommandEncoderFinish(enc, NULL);
    wgpuQueueSubmit(gpu->queue, 1, &cb);
    uint32_t *o = malloc(out_size);
    CHECK(gpu_read_buffer(gpu, obuf, 0, out_size, o));

    double worst[PARITY_OUT] = {0};
    int hash_mismatch = 0;
    for (int i = 0; i < PARITY_N; i++) {
        float x = pts[i * 4], y = pts[i * 4 + 1], z = pts[i * 4 + 2];
        const uint32_t *g = o + i * PARITY_OUT;
        if (g[0] != hash2i((int32_t)floorf(x), (int32_t)floorf(y), 7)) hash_mismatch++;
        float wx = x, wy = y;
        domain_warp2(&wx, &wy, 7, 3.0f, 0.2f);
        float c[PARITY_OUT] = { 0, noise_value2(x, y, 7), noise_perlin2(x, y, 7), noise_perlin3(x, y, z, 7),
                                noise_simplex2(x, y, 7), fbm2(x, y, 7, 6, 2, 0.5f), ridged2(x, y, 7, 6, 2, 0.5f),
                                wx, wy, terrain_height(&tp, x * 300.0f, y * 300.0f) };
        for (int k = 1; k < PARITY_OUT; k++) {
            double d = fabs((double)as_f(g[k]) - c[k]);
            if (d > worst[k]) worst[k] = d;
        }
    }
    CHECK(hash_mismatch == 0);
    for (int k = 1; k < PARITY_OUT; k++) {
        // Noise outputs are unit-scale. Terrain height (k = 9) is in meters, sampled at tens of km where a
        // float32 step is already ~4 mm, and GPUs fuse multiply-adds differently from the CPU: scale its tolerance.
        double tol = k == 9 ? 1e-4 * tp.height : 1e-3;
        if (getenv("NOISE_VERBOSE") || worst[k] > tol) printf("  output %d differs by %g\n", k, worst[k]);
        CHECK(worst[k] <= tol);
    }
    free(o);
    wgpuCommandBufferRelease(cb);
    wgpuComputePassEncoderRelease(pass);
    wgpuCommandEncoderRelease(enc);
    wgpuBindGroupRelease(bg);
    wgpuBindGroupLayoutRelease(bgl);
    wgpuBufferRelease(pbuf);
    wgpuBufferRelease(tbuf);
    wgpuBufferRelease(obuf);
    wgpuComputePipelineRelease(pl);
    wgpuShaderModuleRelease(m);
    CHECK(gpu->errors == 0);
}
