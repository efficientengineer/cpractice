// Procedural World engine, chapter 00: WebGPU setup, fullscreen passes, the frame loop, error handling.
//
// Public API (all on the global W namespace):
//   W.gpu.init(canvas?, opts?)           -> Promise<gpu>  device (+ configured canvas context); gpu = { device, context, format, canvas, width, height }
//   W.gpu.checkResize(gpu)               -> bool          true if the canvas size changed since the last call (updates gpu.width/height)
//   W.gpu.compile(device, code, label?)  -> Promise<GPUShaderModule>  throws an Error listing WGSL errors with source lines
//   W.gpu.checked(device, fn, label?)    -> Promise<fn()>  runs fn inside validation + out-of-memory error scopes, throws on error
//   W.gpu.logErrors(device, max?)        installs (once) an 'uncapturederror' listener that prints the first `max` errors
//   W.gpu.uniformBuffer(device, bytes, label?) -> GPUBuffer  UNIFORM | COPY_DST, size rounded up to 16
//   W.gpu.bindGroup(device, layout, resources, label?) -> GPUBindGroup  resources[i] goes to binding i
//   W.gpu.target(device, w, h, format?)  -> GPUTexture    render target you can read back (RENDER_ATTACHMENT | TEXTURE_BINDING | COPY_SRC)
//   W.gpu.loop(fn(dt, t, frame), opts?)  -> { stop(), frames, running }  requestAnimationFrame loop with clamped dt
//   new W.gpu.FullscreenPass(device, { code, format, layouts?, depth?, blend?, label? })
//       .pipeline, .draw(passEncoder, ...bindGroups)   one triangle covering the screen; `code` defines @fragment fn fs(in: FullscreenOut)
//   W.wgsl.fullscreen   WGSL: struct FullscreenOut { pos, uv } + @vertex fn vs  (uv (0,0) = top-left, z = 0 = far plane in reversed-Z)
//   W.wgsl.color        WGSL: linearToSrgb(c: vec3f) -> vec3f, srgbToLinear(c: vec3f) -> vec3f
//   W.wgsl.sky          WGSL: skyColor(dir, sunDir, zenith, horizon, ground, sunColor) -> vec3f  (linear radiance)
//
// Performance rules introduced here and kept for the whole course:
//   create once (pipelines, layouts, buffers, bind groups), update per frame (one writeBuffer of uniforms),
//   allocate nothing in the frame loop, never read GPU data back inside the loop.
self.W = self.W || {};
W.wgsl = W.wgsl || {};
W.gpu = W.gpu || {};

(function () {
  const gpu = W.gpu;

  // ---------------------------------------------------------------- device and canvas
  // The site's worker provides getDevice() (one shared device per run); elsewhere we request our own.
  async function requestDevice() {
    if (typeof self.getDevice === 'function') return self.getDevice();
    if (!navigator.gpu) throw new Error('WebGPU is not available in this browser.');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU adapter found.');
    return adapter.requestDevice();
  }

  gpu.init = async function init(canvas, opts = {}) {
    const device = await requestDevice();
    gpu.logErrors(device);
    const out = { device, context: null, format: opts.format || navigator.gpu.getPreferredCanvasFormat(), canvas: canvas || null, width: 0, height: 0 };
    if (canvas) {
      out.context = canvas.getContext('webgpu');
      // 'opaque': the page never blends our canvas with what's behind it (cheaper, and alpha bugs can't show through).
      out.context.configure({ device, format: out.format, alphaMode: 'opaque', usage: GPUTextureUsage.RENDER_ATTACHMENT | (opts.usage || 0) });
      gpu.checkResize(out);
    }
    return out;
  };

  // A canvas has a drawing-buffer size (canvas.width/height) separate from its size on the page.
  // On the main thread we match the drawing buffer to the displayed size; an OffscreenCanvas in a
  // worker is resized by its owner. Either way, size-dependent resources (depth buffers, post-process
  // targets) are recreated only when this returns true, never every frame.
  gpu.checkResize = function checkResize(g) {
    const c = g.canvas;
    if (!c) return false;
    if (typeof c.clientWidth === 'number' && c.clientWidth > 0) {
      const dpr = self.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
      if (c.width !== w) c.width = w;
      if (c.height !== h) c.height = h;
    }
    if (c.width === g.width && c.height === g.height) return false;
    g.width = c.width; g.height = c.height;
    return true;
  };

  // ---------------------------------------------------------------- errors
  // WebGPU calls don't throw on misuse: the object becomes invalid and an error is reported later.
  const logged = new WeakSet();
  gpu.logErrors = function logErrors(device, max = 20) {
    if (logged.has(device)) return;
    logged.add(device);
    let n = 0;
    device.addEventListener('uncapturederror', e => {
      if (n++ < max) console.error('WebGPU error: ' + e.error.message);
      else if (n === max + 1) console.error('WebGPU: further errors suppressed');
    });
  };

  // Compile WGSL and fail loudly, with the offending lines, instead of getting an invalid module.
  gpu.compile = async function compile(device, code, label = 'shader') {
    const module = device.createShaderModule({ code, label });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter(m => m.type === 'error');
    if (errors.length) {
      const lines = code.split('\n');
      const text = errors.map(m => `${label}:${m.lineNum}:${m.linePos} ${m.message}\n    ${(lines[m.lineNum - 1] || '').trim()}`).join('\n');
      throw new Error('WGSL compilation failed:\n' + text);
    }
    return module;
  };

  // Run fn (sync or async) inside error scopes; scopes are a stack, so pop in reverse order.
  gpu.checked = async function checked(device, fn, label = 'WebGPU') {
    device.pushErrorScope('out-of-memory');
    device.pushErrorScope('validation');
    let result, thrown = null;
    try { result = await fn(); } catch (e) { thrown = e; }
    const validation = await device.popErrorScope();
    const oom = await device.popErrorScope();
    if (thrown) throw thrown;
    const err = validation || oom;
    if (err) throw new Error(`${label}: ${err.message}`);
    return result;
  };

  // ---------------------------------------------------------------- small resource helpers
  gpu.uniformBuffer = function uniformBuffer(device, bytes, label) {
    return device.createBuffer({ size: Math.ceil(bytes / 16) * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label });
  };

  // resources[i] becomes binding i: a GPUBuffer, a GPUTexture (its default view), a view or a sampler.
  gpu.bindGroup = function bindGroup(device, layout, resources, label) {
    const entries = resources.map((r, binding) => ({
      binding,
      resource: r instanceof GPUBuffer ? { buffer: r } : r instanceof GPUTexture ? r.createView() : r
    }));
    return device.createBindGroup({ layout, entries, label });
  };

  gpu.target = function target(device, w, h, format = 'rgba8unorm') {
    return device.createTexture({ size: [w, h], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
  };

  // ---------------------------------------------------------------- frame loop
  // requestAnimationFrame (available in workers for OffscreenCanvas) paces us to the display.
  // dt is clamped so a stall (tab switch, breakpoint) doesn't make the simulation jump.
  gpu.loop = function loop(fn, opts = {}) {
    const maxDt = opts.maxDt || 0.1;
    const raf = typeof self.requestAnimationFrame === 'function' ? self.requestAnimationFrame.bind(self) : cb => setTimeout(() => cb(performance.now()), 16);
    const handle = { frames: 0, running: true, time: 0, stop() { handle.running = false; } };
    let last = -1;
    function tick(now) {                       // the same function object every frame: no closure allocation
      if (!handle.running) return;
      const dt = last < 0 ? 1 / 60 : Math.min((now - last) / 1000, maxDt);
      last = now;
      handle.time += dt;
      try { fn(dt, handle.time, handle.frames); }
      catch (e) { handle.running = false; console.error(e && e.stack ? e.stack : String(e)); return; }
      handle.frames++;
      raf(tick);
    }
    raf(tick);
    return handle;
  };

  // ---------------------------------------------------------------- fullscreen pass
  // A single oversized triangle covers the viewport: cheaper than a quad (no diagonal seam where
  // pixel quads are shaded twice) and it needs no vertex buffer.
  W.wgsl.fullscreen = /* wgsl */`
struct FullscreenOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,          // (0,0) top-left .. (1,1) bottom-right
};
@vertex fn vs(@builtin(vertex_index) i: u32) -> FullscreenOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));   // (0,0) (2,0) (0,2)
  var o: FullscreenOut;
  o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);             // z = 0: the far plane in reversed-Z
  o.uv = vec2f(p.x, 1.0 - p.y);
  return o;
}
`;

  gpu.FullscreenPass = class FullscreenPass {
    // code: WGSL defining `@fragment fn fs(in: FullscreenOut) -> @location(0) vec4f` (and its bindings).
    // layouts: explicit bind group layouts (e.g. [frameLayout, ...]); omitted = layout 'auto'.
    // depth: { format, compare } to draw inside a pass that has a depth attachment (sky behind terrain).
    constructor(device, { code, format, layouts, depth, blend, label = 'fullscreen' }) {
      this.device = device;
      const module = device.createShaderModule({ code: W.wgsl.fullscreen + code, label });
      this.pipeline = device.createRenderPipeline({
        label,
        layout: layouts ? device.createPipelineLayout({ bindGroupLayouts: layouts }) : 'auto',
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [{ format, blend }] },
        primitive: { topology: 'triangle-list' },
        depthStencil: depth ? { format: depth.format || 'depth32float', depthWriteEnabled: false, depthCompare: depth.compare || 'greater-equal' } : undefined
      });
    }
    layout(i) { return this.pipeline.getBindGroupLayout(i); }
    draw(pass, ...groups) {
      pass.setPipeline(this.pipeline);
      for (let i = 0; i < groups.length; i++) pass.setBindGroup(i, groups[i]);
      pass.draw(3);
    }
  };

  // ---------------------------------------------------------------- shared WGSL snippets
  // Lighting math happens in linear space; the canvas format (bgra8unorm) stores what we write, so we
  // encode to sRGB ourselves at the very end (exact piecewise curve, not pow(1/2.2)).
  W.wgsl.color = /* wgsl */`
fn linearToSrgb(c: vec3f) -> vec3f {
  let x = max(c, vec3f(0.0));
  return select(1.055 * pow(x, vec3f(1.0 / 2.4)) - 0.055, x * 12.92, x <= vec3f(0.0031308));
}
fn srgbToLinear(c: vec3f) -> vec3f {
  return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045));
}
`;

  // An analytic sky: gradient from horizon to zenith, darker ground below, a sun disk with a glow.
  // Inputs are linear colours; dir and sunDir are unit vectors (Y up). Chapter 21 replaces this
  // with a physically based atmosphere.
  W.wgsl.sky = /* wgsl */`
fn skyColor(dir: vec3f, sunDir: vec3f, zenith: vec3f, horizon: vec3f, ground: vec3f, sunColor: vec3f) -> vec3f {
  let y = dir.y;
  var c = mix(horizon, zenith, pow(clamp(y, 0.0, 1.0), 0.45));
  c = mix(c, ground, smoothstep(0.0, -0.15, y));               // below the horizon
  let cosA = dot(dir, sunDir);
  c += sunColor * (0.25 * pow(max(cosA, 0.0), 8.0) + 0.6 * pow(max(cosA, 0.0), 200.0));   // glow
  c += sunColor * 8.0 * smoothstep(0.99985, 0.99992, cosA) * smoothstep(-0.02, 0.01, y); // disk (~0.6 deg)
  return c;
}
`;
})();
