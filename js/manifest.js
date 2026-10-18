// C chapter files (also read by tools/verify.mjs).
window.CHAPTER_FILES = [
  '00-start', '01-types', '02-control', '03-functions', '04-pointers',
  '05-arrays', '06-strings', '07-structs', '08-memory',
  '09-datastructures', '10-funcptrs', '11-bits', '12-io',
  '13-preprocessor', '14-ub', '15-advanced', '16-projects',
  '# Game development', 'g1-tilemap', 'g2-physics', 'g3-entities', 'g4-procgen', 'g5-pathfinding',
  'g6-snake', 'g7-tetris', 'g8-saves', 'g9-performance'
];
window.COURSES = [
  { id: 'c', title: 'C', lang: 'c', dir: 'content', files: window.CHAPTER_FILES,
    blurb: 'Pointers, memory, strings, undefined behavior. Compiled with gcc and checked with AddressSanitizer.' },
  { id: 'js', title: 'JavaScript', lang: 'js', dir: 'content/js',
    files: ['00-start', '01-functions', '02-objects', '03-arrays', '04-classes', '05-collections', '06-async',
      '07-types', '08-strings', '09-functional', '10-binary', '11-metaprogramming', '12-projects',
      '# Game development', 'g1-loop', 'g2-pong', 'g3-breakout', 'g4-grid-games', 'g5-asteroids', 'g6-platformer',
      'g7-engine', 'g8-performance', 'g9-shooter'],
    blurb: 'Modern JavaScript in depth: closures, this, prototypes, the event loop, iterators, typed arrays. Runs in your browser.' },
  { id: 'webgpu', title: 'WebGPU', lang: 'webgpu', dir: 'content/webgpu',
    files: ['00-start', '01-wgsl', '02-buffers', '03-compute', '04-triangle', '05-vertices', '06-uniforms',
      '07-textures', '08-3d', '09-particles', '10-projects',
      '# Game rendering', 'g1-sprites', 'g2-tilemap', 'g3-effects', 'g4-lighting', 'g5-postfx', 'g6-renderer', 'g7-voxels'],
    blurb: 'GPU programming in the browser: WGSL, compute shaders, render pipelines, textures, 3D. Needs a WebGPU-capable browser.' }
];
