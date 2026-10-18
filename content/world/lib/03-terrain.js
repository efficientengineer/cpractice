// Procedural World engine, chapter 03: math, cameras, reversed-Z depth, Frame uniforms, terrain tile rendering.
//
// Conventions: right-handed, Y up, view space looks down -Z; matrices are column-major Float32Array(16)
// (element [col * 4 + row]), the same layout as WGSL mat4x4f. Every math function writes into an
// `out` argument and returns it, so per-frame code can reuse scratch arrays instead of allocating.
//
// Public API:
//   W.math.clamp(x, a, b), lerp(a, b, t), smoothstep(e0, e1, x), damp(a, b, lambda, dt)  (frame-rate independent smoothing)
//   W.math.vec3: create(x,y,z), set(out,x,y,z), copy(out,a), add(out,a,b), sub(out,a,b), scale(out,a,s),
//                scaleAndAdd(out,a,b,s) (a + b*s), dot(a,b), cross(out,a,b), length(a), distance(a,b), normalize(out,a), lerp(out,a,b,t)
//   W.math.mat4: create() (identity), identity(out), copy(out,a), multiply(out,a,b) (a*b), invert(out,a) (null if singular),
//                perspective(out, fovy, aspect, near, far=Infinity)  REVERSED-Z: near -> depth 1, far -> depth 0
//                lookAt(out, eye, target, up), translation(out, x,y,z), rotationY(out, angle), scaling(out, x,y,z),
//                transformPoint(out, m, p) (with perspective divide), transformVec4(out, m, v)
//   W.gpu.DEPTH_FORMAT = 'depth32float'; W.gpu.depthState(write=true) -> depthStencil state with compare 'greater'
//   W.gpu.depthTarget(device, w, h) -> GPUTexture (depth32float, RENDER_ATTACHMENT | TEXTURE_BINDING); clear it to 0
//   W.Camera({ fovy=60deg, near=0.1, far=Infinity })  .eye (vec3) .yaw .pitch .view .proj .forward
//       .updateMatrices(aspect)  view from eye/yaw/pitch (yaw 0 looks down -Z, positive yaw turns left)
//       .lookAt(target)          sets yaw/pitch to face a point
//   W.OrbitCamera(opts) extends Camera: .target (vec3) .distance .update(dt, keys, mouse) (mouse dx/dy or arrows rotate, W/S zoom), .autoRotate (rad/s)
//   W.wgsl.frame        WGSL: struct Frame + @group(0) @binding(0) var<uniform> frame: Frame
//   W.FRAME_BYTES = 368 and W.FRAME_LAYOUT = { field: float offset } (see struct)
//   W.FrameUniforms(device)  .data (Float32Array) .buffer .layout .bindGroup
//       .setCamera(camera) (view, proj, viewProj, invViewProj, cameraPos), .setTime(t, dt), .setResolution(w, h)
//       .cameraPos .sunDir .sunColor .skyColor .fogColor .groundColor .resolution .jitter  (subarray views to write into)
//       .fogDensity .fogHeightFalloff .fogHeight .frameIndex (setters), .setSun(dir) (normalises), .upload()
//       W.FrameUniforms.layout(device) -> the shared group-0 GPUBindGroupLayout (one per device)
//   W.mesh.grid(cells) -> { vertices: Float32Array (i, j) pairs, indices: Uint16Array|Uint32Array, vertexCount, indexCount }
//   W.mesh.upload(device, mesh) -> { vertexBuffer, indexBuffer, indexFormat, indexCount }
//   W.mesh.gridBuffers(device, cells) -> the uploaded grid, shared per (device, cells)
//   W.TerrainTile(device, { frame, tile, format, fragment?, label? })   draws one HeightTile as a displaced grid
//       .draw(passEncoder)   .setTile(heightTile)
//       W.TerrainTile.layout(device) -> group-1 layout (tile uniform + height texture)
//       W.TerrainTile.defaultFragment  WGSL for `@fragment fn fs(in: TerrainOut)`; TerrainOut = { pos, world: vec3f, normal: vec3f }
self.W = self.W || {};
W.wgsl = W.wgsl || {};
W.gpu = W.gpu || {};

(function () {
  // ================================================================ scalar helpers
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  // Exponential smoothing: a += (b - a) * (1 - exp(-lambda * dt)). Unlike `a += (b - a) * 0.1` per
  // frame it converges at the same rate at 30, 60 or 144 fps.
  const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

  // ================================================================ vec3
  const vec3 = {
    create: (x = 0, y = 0, z = 0) => { const v = new Float32Array(3); v[0] = x; v[1] = y; v[2] = z; return v; },
    set(o, x, y, z) { o[0] = x; o[1] = y; o[2] = z; return o; },
    copy(o, a) { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; },
    add(o, a, b) { o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; o[2] = a[2] + b[2]; return o; },
    sub(o, a, b) { o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2]; return o; },
    scale(o, a, s) { o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s; return o; },
    scaleAndAdd(o, a, b, s) { o[0] = a[0] + b[0] * s; o[1] = a[1] + b[1] * s; o[2] = a[2] + b[2] * s; return o; },
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross(o, a, b) {
      const x = a[1] * b[2] - a[2] * b[1], y = a[2] * b[0] - a[0] * b[2], z = a[0] * b[1] - a[1] * b[0];
      o[0] = x; o[1] = y; o[2] = z; return o;
    },
    length: a => Math.hypot(a[0], a[1], a[2]),
    distance: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
    normalize(o, a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; o[0] = a[0] / l; o[1] = a[1] / l; o[2] = a[2] / l; return o; },
    lerp(o, a, b, t) { o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t; return o; }
  };

  // ================================================================ mat4 (column-major)
  const mat4 = {
    create() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
    identity(o) { o.fill(0); o[0] = o[5] = o[10] = o[15] = 1; return o; },
    copy(o, a) { o.set(a); return o; },
    // o = a * b (apply b first). Safe when o aliases a or b.
    multiply(o, a, b) {
      const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
      const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
      for (let c = 0; c < 4; c++) {
        const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
        o[c * 4] = a00 * b0 + a10 * b1 + a20 * b2 + a30 * b3;
        o[c * 4 + 1] = a01 * b0 + a11 * b1 + a21 * b2 + a31 * b3;
        o[c * 4 + 2] = a02 * b0 + a12 * b1 + a22 * b2 + a32 * b3;
        o[c * 4 + 3] = a03 * b0 + a13 * b1 + a23 * b2 + a33 * b3;
      }
      return o;
    },
    invert(o, a) {
      const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
      const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
      const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
      const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
      const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
      const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
      let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
      if (!det) return null;
      det = 1 / det;
      o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;  o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
      o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;  o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
      o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;  o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
      o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;  o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
      o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;  o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
      o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
      o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
      o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
      return o;
    },
    // Reversed-Z perspective. A float's precision is densest near 0; standard Z maps the far
    // distance to ~1 where floats are coarse AND the 1/z mapping crowds precision near the camera,
    // so distant terrain z-fights. Mapping far -> 0 makes the two effects cancel (Reed 2015,
    // "Depth Precision Visualized"). With far = Infinity there is no far plane at all.
    //   clip.z = A * z + B, clip.w = -z;  depth = clip.z / clip.w
    //   finite:   A = near / (far - near), B = far * near / (far - near)  -> z=-near: 1, z=-far: 0
    //   infinite: A = 0,                   B = near                        -> depth = near / -z
    perspective(o, fovy, aspect, near, far = Infinity) {
      const f = 1 / Math.tan(fovy / 2);
      o.fill(0);
      o[0] = f / aspect; o[5] = f; o[11] = -1;
      if (far === Infinity) { o[10] = 0; o[14] = near; }
      else { o[10] = near / (far - near); o[14] = far * near / (far - near); }
      return o;
    },
    // View matrix: rows are the camera's right, up and back axes; translation moves the eye to the origin.
    lookAt(o, eye, target, up) {
      let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
      let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
      let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
      l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
      const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
      o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0;
      o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
      o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
      o[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
      o[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
      o[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
      o[15] = 1;
      return o;
    },
    translation(o, x, y, z) { mat4.identity(o); o[12] = x; o[13] = y; o[14] = z; return o; },
    scaling(o, x, y, z) { mat4.identity(o); o[0] = x; o[5] = y; o[10] = z; return o; },
    rotationY(o, a) { mat4.identity(o); const c = Math.cos(a), s = Math.sin(a); o[0] = c; o[2] = -s; o[8] = s; o[10] = c; return o; },
    transformVec4(o, m, v) {
      const x = v[0], y = v[1], z = v[2], w = v[3];
      for (let r = 0; r < 4; r++) o[r] = m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r] * w;
      return o;
    },
    transformPoint(o, m, p) {
      const x = p[0], y = p[1], z = p[2];
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      o[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
      o[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
      o[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
      return o;
    }
  };
  W.math = { clamp, lerp, smoothstep, damp, vec3, mat4 };

  // ================================================================ depth (reversed-Z)
  W.gpu.DEPTH_FORMAT = 'depth32float';
  // Reversed-Z: clear depth to 0 (far), keep fragments with GREATER depth (closer).
  W.gpu.depthState = (write = true) => ({ format: 'depth32float', depthWriteEnabled: write, depthCompare: 'greater' });
  W.gpu.depthTarget = (device, w, h) => device.createTexture({
    size: [w, h], format: 'depth32float', label: 'depth',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
  });

  // ================================================================ cameras
  const UP = vec3.create(0, 1, 0);
  W.Camera = class Camera {
    constructor({ fovy = 60 * Math.PI / 180, near = 0.1, far = Infinity } = {}) {
      this.fovy = fovy; this.near = near; this.far = far;
      this.eye = vec3.create(0, 2, 0);
      this.yaw = 0; this.pitch = 0;
      this.view = mat4.create(); this.proj = mat4.create();
      this.forward = vec3.create(0, 0, -1);
      this._target = vec3.create();
    }
    updateMatrices(aspect) {
      const cp = Math.cos(this.pitch), f = this.forward;
      vec3.set(f, -Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
      mat4.lookAt(this.view, this.eye, vec3.add(this._target, this.eye, f), UP);
      mat4.perspective(this.proj, this.fovy, aspect, this.near, this.far);
    }
    lookAt(t) {
      const dx = t[0] - this.eye[0], dy = t[1] - this.eye[1], dz = t[2] - this.eye[2];
      this.yaw = Math.atan2(-dx, -dz);
      this.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    }
  };

  // Orbits a target: mouse (dx/dy, drag or pointer lock) or arrow keys rotate, W/S zoom.
  W.OrbitCamera = class OrbitCamera extends W.Camera {
    constructor(opts = {}) {
      super(opts);
      this.target = vec3.create(...(opts.target || [0, 0, 0]));
      this.distance = opts.distance || 200;
      this.yaw = opts.yaw || 0.6; this.pitch = opts.pitch !== undefined ? opts.pitch : -0.5;
      this.autoRotate = opts.autoRotate || 0;
      this.sensitivity = 0.004;
    }
    update(dt, keys, mouse) {
      if (mouse) { this.yaw -= mouse.dx * this.sensitivity; this.pitch -= mouse.dy * this.sensitivity; mouse.dx = mouse.dy = 0; }
      if (keys) {
        if (keys.has('ArrowLeft')) this.yaw += 1.5 * dt;
        if (keys.has('ArrowRight')) this.yaw -= 1.5 * dt;
        if (keys.has('ArrowUp')) this.pitch += 1.0 * dt;
        if (keys.has('ArrowDown')) this.pitch -= 1.0 * dt;
        if (keys.has('KeyW')) this.distance *= Math.exp(-1.5 * dt);
        if (keys.has('KeyS')) this.distance *= Math.exp(1.5 * dt);
      }
      this.yaw += this.autoRotate * dt;
      this.pitch = clamp(this.pitch, -1.5, 1.5);
      // The eye sits `distance` behind the target along the view direction.
      const cp = Math.cos(this.pitch);
      vec3.set(this.eye, this.target[0] + Math.sin(this.yaw) * cp * this.distance,
        this.target[1] - Math.sin(this.pitch) * this.distance,
        this.target[2] + Math.cos(this.yaw) * cp * this.distance);
    }
  };

  // ================================================================ Frame uniforms
  // One uniform buffer, written once per frame, bound at group 0 binding 0 in every world pipeline.
  // Offsets follow WGSL alignment: mat4x4f = 64 bytes, vec3f aligns to 16 so a scalar packs after it.
  // Later chapters may append fields at the end only.
  W.wgsl.frame = /* wgsl */`
struct Frame {
  view: mat4x4f,            // byte 0
  proj: mat4x4f,            // 64
  viewProj: mat4x4f,        // 128
  invViewProj: mat4x4f,     // 192
  cameraPos: vec3f,         // 256
  time: f32,                // 268  seconds since start
  sunDir: vec3f,            // 272  unit vector pointing TOWARD the sun
  frameIndex: u32,          // 284
  sunColor: vec3f,          // 288  linear radiance
  dt: f32,                  // 300
  skyColor: vec3f,          // 304  zenith colour, also the ambient light from above
  fogDensity: f32,          // 316  extinction per metre at fogHeight
  fogColor: vec3f,          // 320  horizon colour: fog and sky meet here
  fogHeightFalloff: f32,    // 332  1/metres: how fast fog thins with altitude
  groundColor: vec3f,       // 336  ambient light from below (bounce)
  fogHeight: f32,           // 348  altitude where density = fogDensity
  resolution: vec2f,        // 352  render target size in pixels
  jitter: vec2f,            // 360  sub-pixel projection jitter (TAA, chapter 20)
};                          // 368 bytes
@group(0) @binding(0) var<uniform> frame: Frame;
`;
  W.FRAME_BYTES = 368;
  W.FRAME_LAYOUT = { view: 0, proj: 16, viewProj: 32, invViewProj: 48, cameraPos: 64, time: 67, sunDir: 68, frameIndex: 71,
    sunColor: 72, dt: 75, skyColor: 76, fogDensity: 79, fogColor: 80, fogHeightFalloff: 83, groundColor: 84, fogHeight: 87,
    resolution: 88, jitter: 90 };   // offsets in floats

  const frameLayouts = new WeakMap();
  W.FrameUniforms = class FrameUniforms {
    // An explicit layout shared by every pipeline lets one bind group serve them all
    // (with layout: 'auto' each pipeline would need its own bind group).
    static layout(device) {
      let l = frameLayouts.get(device);
      if (!l) {
        l = device.createBindGroupLayout({ label: 'frame', entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }] });
        frameLayouts.set(device, l);
      }
      return l;
    }
    constructor(device) {
      const L = W.FRAME_LAYOUT;
      this.device = device;
      this.data = new Float32Array(W.FRAME_BYTES / 4);
      this.u32 = new Uint32Array(this.data.buffer);
      this.buffer = W.gpu.uniformBuffer(device, W.FRAME_BYTES, 'frame');
      this.layout = FrameUniforms.layout(device);
      this.bindGroup = device.createBindGroup({ layout: this.layout, entries: [{ binding: 0, resource: { buffer: this.buffer } }], label: 'frame' });
      const v = (o, n) => this.data.subarray(o, o + n);
      this.view = v(L.view, 16); this.proj = v(L.proj, 16); this.viewProj = v(L.viewProj, 16); this.invViewProj = v(L.invViewProj, 16);
      this.cameraPos = v(L.cameraPos, 3); this.sunDir = v(L.sunDir, 3); this.sunColor = v(L.sunColor, 3);
      this.skyColor = v(L.skyColor, 3); this.fogColor = v(L.fogColor, 3); this.groundColor = v(L.groundColor, 3);
      this.resolution = v(L.resolution, 2); this.jitter = v(L.jitter, 2);
      // A pleasant afternoon; chapter 21 drives these from a time of day.
      this.setSun([0.45, 0.55, -0.7]);
      this.sunColor.set([1.6, 1.45, 1.25]);
      this.skyColor.set([0.22, 0.42, 0.85]);
      this.fogColor.set([0.62, 0.72, 0.86]);
      this.groundColor.set([0.25, 0.22, 0.18]);
      this.fogDensity = 0.0012; this.fogHeightFalloff = 0.02; this.fogHeight = 0;
    }
    setSun(dir) { vec3.normalize(this.sunDir, dir); }
    setCamera(cam) {
      this.view.set(cam.view); this.proj.set(cam.proj);
      mat4.multiply(this.viewProj, cam.proj, cam.view);
      mat4.invert(this.invViewProj, this.viewProj);
      this.cameraPos.set(cam.eye);
    }
    setTime(t, dt) { this.data[W.FRAME_LAYOUT.time] = t; this.data[W.FRAME_LAYOUT.dt] = dt; }
    setResolution(w, h) { this.resolution[0] = w; this.resolution[1] = h; }
    set fogDensity(x) { this.data[W.FRAME_LAYOUT.fogDensity] = x; }      get fogDensity() { return this.data[W.FRAME_LAYOUT.fogDensity]; }
    set fogHeightFalloff(x) { this.data[W.FRAME_LAYOUT.fogHeightFalloff] = x; } get fogHeightFalloff() { return this.data[W.FRAME_LAYOUT.fogHeightFalloff]; }
    set fogHeight(x) { this.data[W.FRAME_LAYOUT.fogHeight] = x; }        get fogHeight() { return this.data[W.FRAME_LAYOUT.fogHeight]; }
    set frameIndex(x) { this.u32[W.FRAME_LAYOUT.frameIndex] = x; }       get frameIndex() { return this.u32[W.FRAME_LAYOUT.frameIndex]; }
    get time() { return this.data[W.FRAME_LAYOUT.time]; }
    upload() { this.device.queue.writeBuffer(this.buffer, 0, this.data); }
  };

  // ================================================================ grid mesh
  // Generated once and shared by every tile: each vertex is just its integer grid coordinate (i, j);
  // the vertex shader turns it into a world position and fetches the height texel at (i, j).
  W.mesh = W.mesh || {};
  W.mesh.grid = function grid(cells) {
    const n = cells + 1, vertexCount = n * n;
    const vertices = new Float32Array(vertexCount * 2);
    for (let j = 0, k = 0; j < n; j++) for (let i = 0; i < n; i++) { vertices[k++] = i; vertices[k++] = j; }
    // 16-bit indices halve index bandwidth; they fit while there are at most 65536 vertices (255 cells).
    const indices = vertexCount <= 65536 ? new Uint16Array(cells * cells * 6) : new Uint32Array(cells * cells * 6);
    for (let j = 0, k = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
      const a = j * n + i, b = a + n;      // b is the vertex one row further in +Z
      // Counter-clockwise seen from above (+Y), so back-face culling keeps the top side.
      indices[k++] = a; indices[k++] = b; indices[k++] = a + 1;
      indices[k++] = a + 1; indices[k++] = b; indices[k++] = b + 1;
    }
    return { vertices, indices, vertexCount, indexCount: indices.length };
  };
  W.mesh.upload = function upload(device, mesh) {
    const vertexBuffer = device.createBuffer({ size: mesh.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, label: 'vertices' });
    device.queue.writeBuffer(vertexBuffer, 0, mesh.vertices);
    // writeBuffer sizes must be multiples of 4 bytes: pad an odd count of 16-bit indices.
    let idx = mesh.indices;
    if (idx.byteLength % 4) { const p = new idx.constructor(idx.length + 1); p.set(idx); idx = p; }
    const indexBuffer = device.createBuffer({ size: idx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST, label: 'indices' });
    device.queue.writeBuffer(indexBuffer, 0, idx);
    return { vertexBuffer, indexBuffer, indexFormat: idx instanceof Uint16Array ? 'uint16' : 'uint32', indexCount: mesh.indices.length };
  };
  const gridCache = new WeakMap();
  W.mesh.gridBuffers = function gridBuffers(device, cells) {
    let m = gridCache.get(device);
    if (!m) gridCache.set(device, m = new Map());
    if (!m.has(cells)) m.set(cells, W.mesh.upload(device, W.mesh.grid(cells)));
    return m.get(cells);
  };

  // ================================================================ terrain tile renderer
  const tileLayouts = new WeakMap();
  const pipelines = new WeakMap();   // device -> Map(format + fragment -> pipeline)

  const terrainVS = /* wgsl */`
struct TileParams { origin: vec2f, spacing: f32, size: u32 };
@group(1) @binding(0) var<uniform> tile: TileParams;
@group(1) @binding(1) var heightTex: texture_2d<f32>;

struct TerrainOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
};
fn tileHeight(ij: vec2i) -> f32 {
  let c = clamp(ij, vec2i(0), vec2i(i32(tile.size) - 1));
  return textureLoad(heightTex, c, 0).r;    // r32float can't be filtered; vertices sit on texels anyway
}
@vertex fn vs(@location(0) grid: vec2f) -> TerrainOut {
  let ij = vec2i(grid);
  let h = tileHeight(ij);
  // Central differences: slope along x and z from the neighbours (one-sided at the tile edge).
  let hl = tileHeight(ij - vec2i(1, 0)); let hr = tileHeight(ij + vec2i(1, 0));
  let hd = tileHeight(ij - vec2i(0, 1)); let hu = tileHeight(ij + vec2i(0, 1));
  var o: TerrainOut;
  o.world = vec3f(tile.origin.x + grid.x * tile.spacing, h, tile.origin.y + grid.y * tile.spacing);
  o.normal = normalize(vec3f(hl - hr, 2.0 * tile.spacing, hd - hu));
  o.pos = frame.viewProj * vec4f(o.world, 1.0);
  return o;
}
`;

  W.TerrainTile = class TerrainTile {
    static layout(device) {
      let l = tileLayouts.get(device);
      if (!l) {
        l = device.createBindGroupLayout({ label: 'terrain tile', entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
          { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }
        ] });
        tileLayouts.set(device, l);
      }
      return l;
    }
    static pipeline(device, format, fragment) {
      let m = pipelines.get(device);
      if (!m) pipelines.set(device, m = new Map());
      const key = format + '\n' + fragment;
      let p = m.get(key);
      if (!p) {
        const code = W.wgsl.frame + W.wgsl.color + W.wgsl.hash + W.wgsl.noise + terrainVS + fragment;
        const module = device.createShaderModule({ code, label: 'terrain' });
        p = device.createRenderPipeline({
          label: 'terrain',
          layout: device.createPipelineLayout({ bindGroupLayouts: [W.FrameUniforms.layout(device), TerrainTile.layout(device)] }),
          vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] }] },
          fragment: { module, entryPoint: 'fs', targets: [{ format }] },
          primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
          depthStencil: W.gpu.depthState(true)
        });
        m.set(key, p);
      }
      return p;
    }
    constructor(device, { frame, tile, format, fragment = TerrainTile.defaultFragment, label = 'terrain tile' }) {
      this.device = device; this.frame = frame; this.format = format;
      this.pipeline = TerrainTile.pipeline(device, format, fragment);
      this.uniforms = new Float32Array(4); this.uniformU32 = new Uint32Array(this.uniforms.buffer);
      this.uniformBuffer = W.gpu.uniformBuffer(device, 16, label);
      if (tile) this.setTile(tile);
    }
    // Point the renderer at a (re)generated HeightTile. Done when the tile changes, not per frame.
    setTile(tile) {
      this.tile = tile;
      this.uniforms[0] = tile.originX; this.uniforms[1] = tile.originZ; this.uniforms[2] = tile.spacing; this.uniformU32[3] = tile.size;
      this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniforms);
      this.grid = W.mesh.gridBuffers(this.device, tile.size - 1);
      this.bindGroup = W.gpu.bindGroup(this.device, TerrainTile.layout(this.device), [this.uniformBuffer, tile.texture.createView()]);
    }
    draw(pass) {
      const g = this.grid;
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, this.frame.bindGroup);
      pass.setBindGroup(1, this.bindGroup);
      pass.setVertexBuffer(0, g.vertexBuffer);
      pass.setIndexBuffer(g.indexBuffer, g.indexFormat);
      pass.drawIndexed(g.indexCount);
    }
  };

  // First look: colour by height, simple sun lighting, sRGB output. Chapter 05 replaces this.
  W.TerrainTile.defaultFragment = /* wgsl */`
@fragment fn fs(in: TerrainOut) -> @location(0) vec4f {
  let n = normalize(in.normal);
  let t = clamp(in.world.y / 70.0, 0.0, 1.0);
  let albedo = mix(vec3f(0.12, 0.25, 0.07), vec3f(0.45, 0.42, 0.38), smoothstep(0.2, 0.8, t));
  let light = max(dot(n, frame.sunDir), 0.0) * frame.sunColor + 0.25 * frame.skyColor;
  return vec4f(linearToSrgb(albedo * light), 1.0);
}
`;
})();
