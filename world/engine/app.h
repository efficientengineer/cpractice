// Window, frame loop and input on top of SDL3. Click captures the mouse (mouse look), Esc releases.
#pragma once
#include "gpu.h"
#include <SDL3/SDL.h>

typedef struct Input {
    const bool *keys;                  // held keys, indexed by SDL_SCANCODE_* (physical position: WASD works on any layout)
    bool pressed[SDL_SCANCODE_COUNT];  // went down this frame
    float mouse_x, mouse_y;            // cursor position in window coordinates
    float mouse_dx, mouse_dy;          // relative movement this frame (use for mouse look)
    float wheel;
    bool captured;                     // relative mouse mode: cursor hidden and locked
} Input;

typedef struct App {
    SDL_Window *window;
    Gpu gpu;
    Input input;
    double time, dt;                   // seconds since start, seconds since last frame (clamped)
    uint64_t frame;
    bool resized;                      // surface size changed this frame
    bool quit;
} App;

bool app_init(App *app, const char *title, int width, int height);
// Handles events, updates time and input, handles resize. Returns false when the app should quit.
bool app_frame(App *app);
void app_shutdown(App *app);

// Creates a WebGPU surface for an SDL window (surface.c).
WGPUSurface create_surface(WGPUInstance instance, SDL_Window *window);
