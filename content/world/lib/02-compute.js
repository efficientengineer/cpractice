// Procedural World engine, chapter 02: compute helpers and GPU heightmap tiles.
//
// Public API:
//   W.gpu.storageBuffer(device, bytes, extraUsage?, label?) -> GPUBuffer  STORAGE | COPY_SRC | COPY_DST | extraUsage
//   W.gpu.dispatchSize(n, workgroupSize)    -> number of workgroups covering n items (ceil)
//   W.gpu.computePipeline(device, code, entryPoint='main', layouts?, label?) -> GPUComputePipeline (layout 'auto' unless layouts given)
//   W.gpu.readBuffer(device, buffer, size?, offset?) -> Promise<ArrayBuffer>    TESTS AND TOOLS ONLY: stalls until the GPU is done
//   W.gpu.readTexture(device, texture)      -> Promise<ArrayBuffer>  tightly packed rows of a 4-byte-per-texel 2D texture (r32float, rgba8unorm, ...)
//   W.HeightTile                            one tile's GPU resources, allocated once and reused:
//       new W.HeightTile(device, size)      size = samples per side (e.g. 129 for 128 cells)
//       .size .buffer (f32 storage, row-major: index = j * size + i) .texture (r32float, i = x, j = z)
//       .originX .originZ .spacing          what was last generated into it
//   W.HeightTileGen                         the compute pipeline for one terrain parameter set, created once
//       new W.HeightTileGen(device, params = W.terrain.params)
//       .encode(encoder, tile, originX, originZ, spacing)   records the dispatch (several tiles share one submit)
//   W.genHeightTile(device, { x=0, z=0, size=129, spacing=1, params?, tile? }) -> HeightTile
//       convenience: generates and submits now; reuses a cached generator per (device, params) and `tile` if given.
//       Sample (i, j) is the terrain at (x + i * spacing, z + j * spacing).
self.W = self.W || {};
W.gpu = W.gpu || {};

(function () {
  const gpu = W.gpu;

  gpu.storageBuffer = function storageBuffer(device, bytes, extraUsage = 0, label) {
    return device.createBuffer({ size: Math.ceil(bytes / 4) * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | extraUsage, label });
  };

  gpu.dispatchSize = (n, workgroupSize) => Math.ceil(n / workgroupSize);

  gpu.computePipeline = function computePipeline(device, code, entryPoint = 'main', layouts, label) {
    return device.createComputePipeline({
      label,
      layout: layouts ? device.createPipelineLayout({ bindGroupLayouts: layouts }) : 'auto',
      compute: { module: device.createShaderModule({ code, label }), entryPoint }
    });
  };

  // Readback: copy into a MAP_READ staging buffer, wait for the GPU, copy out. Waiting stalls the
  // CPU/GPU pipeline, which is why this never runs inside a frame loop.
  gpu.readBuffer = async function readBuffer(device, src, size = src.size, offset = 0) {
    const staging = device.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(src, offset, staging, 0, size);
    device.queue.submit([enc.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const out = staging.getMappedRange().slice(0);
    staging.unmap(); staging.destroy();
    return out;
  };

  // Texture-to-buffer copies need bytesPerRow to be a multiple of 256, so rows are padded and we
  // strip the padding while copying out.
  gpu.readTexture = async function readTexture(device, tex) {
    const w = tex.width, h = tex.height, row = w * 4, bpr = Math.ceil(row / 256) * 256;
    const staging = device.createBuffer({ size: bpr * h, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: tex }, { buffer: staging, bytesPerRow: bpr }, [w, h]);
    device.queue.submit([enc.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(staging.getMappedRange()), out = new Uint8Array(row * h);
    for (let y = 0; y < h; y++) out.set(src.subarray(y * bpr, y * bpr + row), y * row);
    staging.unmap(); staging.destroy();
    return out.buffer;
  };

  // ---------------------------------------------------------------- height tiles
  const WG = 8;   // 8x8 = 64 invocations per workgroup: a good default on every vendor

  // The same tile data in two forms: a storage buffer (easy to read back, usable by later compute
  // passes such as erosion) and an r32float texture (what the vertex shader reads with textureLoad).
  W.HeightTile = class HeightTile {
    constructor(device, size = 129) {
      this.device = device;
      this.size = size;
      this.buffer = gpu.storageBuffer(device, size * size * 4, 0, 'height tile buffer');
      this.texture = device.createTexture({
        size: [size, size], format: 'r32float', label: 'height tile texture',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC
      });
      this.uniforms = new Float32Array(4);                 // originX, originZ, spacing, size (as u32 bits)
      this.uniformU32 = new Uint32Array(this.uniforms.buffer);
      this.uniformBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.originX = 0; this.originZ = 0; this.spacing = 1;
      this.bindGroups = new WeakMap();                     // per generator pipeline, made once
    }
    destroy() { this.buffer.destroy(); this.texture.destroy(); this.uniformBuffer.destroy(); }
  };

  const genShader = params => W.wgsl.hash + W.wgsl.noise + W.wgsl.terrain(params) + /* wgsl */`
struct TileParams { origin: vec2f, spacing: f32, size: u32 };
@group(0) @binding(0) var<uniform> tile: TileParams;
@group(0) @binding(1) var<storage, read_write> heights: array<f32>;
@group(0) @binding(2) var heightTex: texture_storage_2d<r32float, write>;

@compute @workgroup_size(${WG}, ${WG})
fn main(@builtin(global_invocation_id) id: vec3u) {
  // The grid of workgroups is rounded up, so threads past the edge must do nothing.
  if (id.x >= tile.size || id.y >= tile.size) { return; }
  let p = tile.origin + vec2f(id.xy) * tile.spacing;
  let h = terrainHeight(p);
  heights[id.y * tile.size + id.x] = h;
  textureStore(heightTex, id.xy, vec4f(h, 0.0, 0.0, 1.0));
}
`;

  W.HeightTileGen = class HeightTileGen {
    constructor(device, params = W.terrain.params) {
      this.device = device;
      this.params = params;
      this.code = genShader(params);
      this.pipeline = gpu.computePipeline(device, this.code, 'main', undefined, 'height tile gen');
    }
    // Writes the tile's uniforms (queue.writeBuffer is ordered before the next submit) and records
    // the dispatch. Nothing is allocated after the first call for a given tile.
    encode(encoder, tile, originX, originZ, spacing) {
      tile.originX = originX; tile.originZ = originZ; tile.spacing = spacing;
      tile.uniforms[0] = originX; tile.uniforms[1] = originZ; tile.uniforms[2] = spacing; tile.uniformU32[3] = tile.size;
      this.device.queue.writeBuffer(tile.uniformBuffer, 0, tile.uniforms);
      let bg = tile.bindGroups.get(this.pipeline);
      if (!bg) {
        bg = gpu.bindGroup(this.device, this.pipeline.getBindGroupLayout(0), [tile.uniformBuffer, tile.buffer, tile.texture.createView()]);
        tile.bindGroups.set(this.pipeline, bg);
      }
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, bg);
      const n = gpu.dispatchSize(tile.size, WG);
      pass.dispatchWorkgroups(n, n);
      pass.end();
    }
  };

  // One generator per (device, params object): compiling a pipeline costs milliseconds, so it is
  // never done per tile.
  const gens = new WeakMap();
  W.genHeightTile = function genHeightTile(device, o = {}) {
    const params = o.params || W.terrain.params;
    let perDevice = gens.get(device);
    if (!perDevice) gens.set(device, perDevice = new WeakMap());
    let gen = perDevice.get(params);
    if (!gen) perDevice.set(params, gen = new W.HeightTileGen(device, params));
    const tile = o.tile || new W.HeightTile(device, o.size || 129);
    const enc = device.createCommandEncoder();
    gen.encode(enc, tile, o.x || 0, o.z || 0, o.spacing || 1);
    device.queue.submit([enc.finish()]);
    return tile;
  };
})();
