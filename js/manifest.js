// C chapter files (also read by tools/verify.mjs).
window.CHAPTER_FILES = [
  '00-start', '01-types', '02-control', '03-functions', '04-pointers',
  '05-arrays', '06-strings', '07-structs', '08-memory',
  '09-datastructures', '10-funcptrs', '11-bits', '12-io',
  '13-preprocessor', '14-ub', '15-advanced', '16-projects',
  '# Procedural graphics', 'p1-images', 'p2-vecmath', 'p3-noise', 'p4-textures', 'p5-terrain',
  'p6-lsystems', 'p7-raymarch', 'p8-performance'
];
// The world course is one continuous project in C (native app in world/). A chapter's "lib:" header
// names engine headers (world/engine/) it introduces; later chapters' online exercises get them prepended.
window.WORLD_FILES = [
  '# Part 1: First light', '00-start', '01-noise', '02-compute', '03-terrain', '04-controller', '05-shading',
  '# Part 2: Terrain at scale', '06-shaping', '07-erosion', '08-chunks', '09-texturing', '10-materials',
  '# Part 3: Populating the world', '11-scatter', '12-rocks', '13-grass', '14-trees', '15-lod',
  '# Part 4: Rendering and optimization', '16-gpu-driven', '17-occlusion', '18-shadows', '19-deferred', '20-postfx',
  '21-sky-water', '22-profiling', '23-world'
];
window.COURSES = [
  { id: 'world', title: 'Procedural World', lang: 'c', dir: 'content/world', libDir: 'world/engine/', files: window.WORLD_FILES,
    blurb: 'One continuous project in C: a procedural, high-detail open world on native WebGPU (Dawn). Terrain, cliffs, rocks, foliage, trees and procedural materials, with LOD, frustum and occlusion culling, GPU-driven rendering, shadows and full-screen effects.' },
  { id: 'js', title: 'JavaScript', lang: 'js', dir: 'content/js',
    files: ['00-start', '01-functions', '02-objects', '03-arrays', '04-classes', '05-collections', '06-async',
      '07-types', '08-strings', '09-functional', '10-binary', '11-metaprogramming', '12-projects',
      '# Procedural generation', 'p1-pixels', 'p2-noise', 'p3-textures', 'p4-lsystems', 'p5-meshes', 'p6-terrain'],
    blurb: 'Modern JavaScript in depth, then CPU-side procedural generation: pixels, noise, textures, L-systems, meshes, terrain.' },
  { id: 'c', title: 'C', lang: 'c', dir: 'content', files: window.CHAPTER_FILES,
    blurb: 'Pointers, memory, undefined behavior, then procedural graphics in C: images, noise, textures, terrain, L-systems, ray marching.' }
];
