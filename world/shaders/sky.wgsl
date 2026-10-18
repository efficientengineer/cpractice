// Chapter 00: a procedural sky from a fullscreen triangle.

struct Sky {
    resolution: vec2f,
    time: f32,
    _pad: f32,
    sun_dir: vec3f,     // direction towards the sun, normalized
    _pad2: f32,
}
@group(0) @binding(0) var<uniform> sky: Sky;

// One triangle that covers the screen: cheaper than a quad (no diagonal seam, fewer helper lanes).
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    let p = array(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
    return vec4f(p[i], 0, 1);
}

@fragment fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
    // View ray for a camera looking down -Z with a 60 degree vertical field of view.
    let uv = (frag.xy / sky.resolution) * 2.0 - 1.0;
    let aspect = sky.resolution.x / sky.resolution.y;
    let t = tan(radians(30.0));
    let dir = normalize(vec3f(uv.x * aspect * t, -uv.y * t + 0.25, -1.0));

    let h = clamp(dir.y, 0.0, 1.0);
    let zenith = vec3f(0.18, 0.36, 0.75);
    let horizon = vec3f(0.70, 0.80, 0.92);
    var col = mix(horizon, zenith, pow(h, 0.5));
    let mu = max(dot(dir, sky.sun_dir), 0.0);
    col += vec3f(1.0, 0.85, 0.6) * (pow(mu, 8.0) * 0.25 + smoothstep(0.9995, 0.9998, mu) * 4.0);
    if (dir.y < 0.0) { col = mix(horizon * 0.6, vec3f(0.25, 0.22, 0.2), clamp(-dir.y * 4.0, 0.0, 1.0)); }
    return vec4f(col / (1.0 + col), 1.0);   // simple Reinhard tone map
}
