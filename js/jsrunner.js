// Runs JavaScript (and WebGPU) code in a Web Worker: console capture, timeouts, OffscreenCanvas.
(function () {
  const WORKER = String.raw`
const inspect = (v, depth = 0, seen = new Set()) => {
  if (typeof v === 'string') return depth ? "'" + v.replace(/'/g, "\\'") + "'" : v;
  if (typeof v === 'bigint') return v + 'n';
  if (typeof v === 'symbol') return v.toString();
  if (typeof v === 'function') return v.name ? '[Function: ' + v.name + ']' : '[Function (anonymous)]';
  if (v === null || typeof v !== 'object') return Object.is(v, -0) ? '-0' : String(v);
  if (seen.has(v)) return '[Circular]';
  if (depth > 3) return Array.isArray(v) ? '[Array]' : '[Object]';
  seen.add(v);
  const d = depth + 1, r = x => inspect(x, d, seen);
  let s;
  if (v instanceof Error) s = String(v);
  else if (Array.isArray(v)) s = v.length ? '[ ' + v.map(r).join(', ') + ' ]' : '[]';
  else if (ArrayBuffer.isView(v) && !(v instanceof DataView)) s = v.constructor.name + '(' + v.length + ') ' + (v.length ? '[ ' + Array.from(v, x => r(x)).join(', ') + ' ]' : '[]');
  else if (v instanceof Map) s = 'Map(' + v.size + ') ' + (v.size ? '{ ' + [...v].map(([k, x]) => r(k) + ' => ' + r(x)).join(', ') + ' }' : '{}');
  else if (v instanceof Set) s = 'Set(' + v.size + ') ' + (v.size ? '{ ' + [...v].map(r).join(', ') + ' }' : '{}');
  else if (v instanceof Date) s = v.toISOString();
  else if (v instanceof RegExp) s = String(v);
  else if (v instanceof Promise) s = 'Promise { ... }';
  else {
    const keys = Object.keys(v), name = v.constructor && v.constructor !== Object ? v.constructor.name + ' ' : (Object.getPrototypeOf(v) === null ? '[Object: null prototype] ' : '');
    s = keys.length ? name + '{ ' + keys.map(k => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : "'" + k + "'") + ': ' + r(v[k])).join(', ') + ' }' : name + '{}';
  }
  seen.delete(v);
  return s;
};
const send = (t, a) => postMessage({ t, s: a.map(x => inspect(x)).join(' ') });
console.log = console.info = console.debug = (...a) => send('out', a);
console.error = console.warn = (...a) => send('err', a);
console.table = (...a) => send('out', a);
let fails_ = 0, checks_ = 0;
const deepEq = (a, b) => {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  if (a instanceof Map || a instanceof Set) return deepEq([...a], [...b]);
  if (a instanceof Date) return +a === +b;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => deepEq(a[k], b[k]));
};
self.check = (cond, msg = 'check failed') => { checks_++; if (!cond) { fails_++; console.log('FAIL: ' + msg); } };
self.eq = (got, want, msg = '') => { checks_++; if (!deepEq(got, want)) { fails_++; console.log('FAIL: ' + (msg ? msg + ': ' : '') + 'got ' + inspect(got, 1) + ', expected ' + inspect(want, 1)); } };
self.near = (got, want, eps = 1e-6, msg = '') => { checks_++; if (!(Math.abs(got - want) <= eps)) { fails_++; console.log('FAIL: ' + (msg ? msg + ': ' : '') + 'got ' + got + ', expected ' + want + ' (±' + eps + ')'); } };
self.throws = (fn, msg = 'expected an exception') => { checks_++; try { fn(); fails_++; console.log('FAIL: ' + msg); } catch {} };
self.rejects = async (p, msg = 'expected a rejection') => { checks_++; try { await (typeof p === 'function' ? p() : p); fails_++; console.log('FAIL: ' + msg); } catch {} };
// WebGPU helpers for tests and examples.
let device_ = null;
self.getDevice = async () => {
  if (device_) return device_;
  if (!navigator.gpu) throw new Error('WebGPU is not available in this browser. Try a recent Chrome or Edge, or Safari 26+/Firefox 141+.');
  const a = await navigator.gpu.requestAdapter();
  if (!a) throw new Error('No WebGPU adapter found.');
  return device_ = await a.requestDevice();
};
self.readBuffer = async (device, src, size = src.size, offset = 0) => {
  const rb = device.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const e = device.createCommandEncoder(); e.copyBufferToBuffer(src, offset, rb, 0, size); device.queue.submit([e.finish()]);
  await rb.mapAsync(GPUMapMode.READ); const out = rb.getMappedRange().slice(0); rb.unmap(); rb.destroy();
  return out;
};
self.readPixels = async (device, tex) => {
  const w = tex.width, h = tex.height, bpr = Math.ceil(w * 4 / 256) * 256;
  const rb = device.createBuffer({ size: bpr * h, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const e = device.createCommandEncoder(); e.copyTextureToBuffer({ texture: tex }, { buffer: rb, bytesPerRow: bpr }, [w, h]); device.queue.submit([e.finish()]);
  await rb.mapAsync(GPUMapMode.READ); const src = new Uint8Array(rb.getMappedRange()), px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) px.set(src.subarray(y * bpr, y * bpr + w * 4), y * w * 4);
  rb.unmap(); rb.destroy();
  return px;
};
self.__testEnd = () => {
  if (!checks_) fails_++;
  console.log(fails_ ? fails_ + ' of ' + checks_ + ' checks failed' : 'ALL TESTS PASSED (' + checks_ + ' checks)');
  return fails_ ? 1 : 0;
};
self.onerror = e => { send('err', ['Uncaught ' + (e.message || e)]); };
self.onunhandledrejection = e => { send('err', ['Unhandled promise rejection: ' + (e.reason && e.reason.stack ? e.reason.stack : inspect(e.reason))]); };
// Keyboard and mouse forwarded from the page (games). keys holds KeyboardEvent.code values.
const keyDown_ = [], keyUp_ = [], mouseDown_ = [];
self.keys = new Set();
self.mouse = { x: 0, y: 0, down: false };
self.input = { keys, mouse, onKeyDown: f => keyDown_.push(f), onKeyUp: f => keyUp_.push(f), onMouseDown: f => mouseDown_.push(f) };
onmessage = async e => {
  if (e.data.t === 'key') {
    const { code, down } = e.data;
    if (code === '*blur') { [...keys].forEach(k => { keys.delete(k); keyUp_.forEach(f => f(k)); }); return; }
    if (down) { if (!keys.has(code)) { keys.add(code); keyDown_.forEach(f => f(code)); } }
    else { keys.delete(code); keyUp_.forEach(f => f(code)); }
    return;
  }
  if (e.data.t === 'mouse') {
    const was = mouse.down; Object.assign(mouse, e.data.m);
    if (mouse.down && !was) mouseDown_.forEach(f => f(mouse.x, mouse.y));
    return;
  }
  const { code, canvas } = e.data;
  self.canvas = canvas;
  let exit = 0;
  try {
    const AsyncFunction = (async () => {}).constructor;
    const r = await new AsyncFunction(code + '\n//# sourceURL=main.js')();
    if (typeof r === 'number') exit = r;
  } catch (err) {
    send('err', [err && err.stack ? String(err.stack).split('\n').filter(l => !/jsrunner|blob:/.test(l)).join('\n') : err]);
    exit = 1;
  }
  postMessage({ t: 'done', exit });
};
`;
  let url = null, current = null;
  function stop() { if (current) { current.terminate(); current = null; } }
  function run(code, opts = {}) {
    stop();
    url ||= URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' }));
    const w = current = new Worker(url);
    const out = [], err = [];
    let live = null;
    return new Promise(resolve => {
      const finish = (exit, timedOut) => {
        clearTimeout(timer);
        if (timedOut || !opts.keepAlive) { w.terminate(); if (current === w) current = null; }
        // Output arriving after the main body finished (game loops, timers) streams to opts.onLate.
        live = timedOut ? null : opts.onLate || null;
        resolve({ backend: 'your browser (Web Worker)', build: '', didExecute: true, stdout: out.join('\n'), stderr: err.join('\n'), exit, timedOut });
      };
      const timer = setTimeout(() => { err.push(`Timed out after ${(opts.timeout || 5000) / 1000}s (infinite loop?)`); finish(124, true); }, opts.timeout || 5000);
      w.onmessage = e => {
        const m = e.data;
        if (m.t === 'out') { out.push(m.s); live && live('out', m.s); }
        else if (m.t === 'err') { err.push(m.s); live && live('err', m.s); }
        else if (m.t === 'done') finish(m.exit, false);
      };
      w.onerror = e => { e.preventDefault(); err.push(String(e.message || 'Worker error')); finish(1, false); };
      w.postMessage({ code, canvas: opts.canvas }, opts.canvas ? [opts.canvas] : []);
    });
  }
  function send(msg) { if (current) current.postMessage(msg); }
  function harness(user, ex) {
    return user + '\n;\n' + ex.harness + '\n;return __testEnd();';
  }
  window.JSRunner = { run, stop, harness, send };
})();
