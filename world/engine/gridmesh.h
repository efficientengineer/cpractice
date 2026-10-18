// gridmesh.h: the terrain grid's index buffer, generated once (CPU module, chapter 03-terrain).
//
// A tile of C x C cells has (C + 1)^2 vertices. There is no vertex buffer: vertex v sits at grid
// coordinate (v % (C + 1), v / (C + 1)) and the vertex shader computes that from
// @builtin(vertex_index) and fetches its height from the tile's height texture ("vertex pulling").
// Every tile with the same C shares one index buffer.
//
//   uint32_t grid_vertex_count(uint32_t cells)          (cells + 1)^2
//   uint32_t grid_index_count(uint32_t cells)           cells * cells * 6
//   bool     grid_fits_u16(uint32_t cells)              16-bit indices are enough (cells <= 255)
//   void     grid_indices_u32(uint32_t cells, uint32_t *out)   two CCW triangles per cell (seen from +Y)
//   void     grid_indices_u16(uint32_t cells, uint16_t *out)
//   uint32_t grid_vertex_x(uint32_t v, uint32_t cells), grid_vertex_z(...)   grid coordinate of vertex v
#pragma once
#include <stdbool.h>
#include <stdint.h>

static inline uint32_t grid_vertex_count(uint32_t cells) { return (cells + 1) * (cells + 1); }
static inline uint32_t grid_index_count(uint32_t cells) { return cells * cells * 6; }
static inline bool grid_fits_u16(uint32_t cells) { return grid_vertex_count(cells) <= 65536u; }
static inline uint32_t grid_vertex_x(uint32_t v, uint32_t cells) { return v % (cells + 1); }
static inline uint32_t grid_vertex_z(uint32_t v, uint32_t cells) { return v / (cells + 1); }

// Cell (i, j) has corners a = (i, j), a + 1 = (i + 1, j), b = (i, j + 1), b + 1. Rows grow toward +Z.
// Seen from above (+Y, looking down), x right and z toward the viewer, a -> b -> a+1 is
// counter-clockwise, so the default front face (CCW) with back-face culling keeps the top.
// Row-major order keeps neighboring triangles' vertices close together: the GPU's post-transform
// vertex cache reuses most of them instead of re-running the vertex shader.
static inline void grid_indices_u32(uint32_t cells, uint32_t *out) {
    uint32_t n = cells + 1, k = 0;
    for (uint32_t j = 0; j < cells; j++)
        for (uint32_t i = 0; i < cells; i++) {
            uint32_t a = j * n + i, b = a + n;
            out[k++] = a; out[k++] = b; out[k++] = a + 1;
            out[k++] = a + 1; out[k++] = b; out[k++] = b + 1;
        }
}

static inline void grid_indices_u16(uint32_t cells, uint16_t *out) {
    uint32_t n = cells + 1, k = 0;
    for (uint32_t j = 0; j < cells; j++)
        for (uint32_t i = 0; i < cells; i++) {
            uint32_t a = j * n + i, b = a + n;
            out[k++] = (uint16_t)a; out[k++] = (uint16_t)b; out[k++] = (uint16_t)(a + 1);
            out[k++] = (uint16_t)(a + 1); out[k++] = (uint16_t)b; out[k++] = (uint16_t)(b + 1);
        }
}
