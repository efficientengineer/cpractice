// C chapter files (also read by tools/verify.mjs).
window.CHAPTER_FILES = [
  '00-start', '01-types', '02-control', '03-functions', '04-pointers',
  '05-arrays', '06-strings', '07-structs', '08-memory',
  '09-datastructures', '10-funcptrs', '11-bits', '12-io',
  '13-preprocessor', '14-ub', '15-advanced', '16-projects',
  '# Procedural graphics', 'p1-images', 'p2-vecmath', 'p3-noise', 'p4-textures', 'p5-terrain',
  'p6-lsystems', 'p7-raymarch', 'p8-performance'
];
window.COURSES = [
  { id: 'c', title: 'C', lang: 'c', dir: 'content', files: window.CHAPTER_FILES,
    blurb: 'Pointers, memory, undefined behavior, then procedural graphics in C: images, noise, textures, terrain, L-systems, ray marching.' },
  { id: 'js', title: 'JavaScript', lang: 'js', dir: 'content/js',
    files: ['00-start', '01-functions', '02-objects', '03-arrays', '04-classes', '05-collections', '06-async',
      '07-types', '08-strings', '09-functional', '10-binary', '11-metaprogramming', '12-projects',
      '# Procedural generation', 'p1-pixels', 'p2-noise', 'p3-textures', 'p4-lsystems', 'p5-meshes', 'p6-terrain'],
    blurb: 'Modern JavaScript in depth, then CPU-side procedural generation: pixels, noise, textures, L-systems, meshes, terrain.' },
  { id: 'webgpu', title: 'WebGPU', lang: 'webgpu', dir: 'content/webgpu',
    files: ['00-start', '01-wgsl', '02-buffers', '03-compute', '04-triangle', '05-vertices', '06-uniforms',
      '07-textures', '08-3d', '09-particles', '10-projects',
      '# 3D procedural graphics', 'p1-controller', 'p2-noise', 'p3-materials', 'p4-baking', 'p5-terrain', 'p6-foliage',
      'p7-trees', 'p8-sdf', 'p9-sky', 'p10-lighting', 'p11-world'],
    blurb: 'GPU fundamentals, then 3D procedural graphics: character controller, shader noise, procedural materials, terrain, foliage, trees, SDFs, sky.' }
];
