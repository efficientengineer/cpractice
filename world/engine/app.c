#include "app.h"
#include "util.h"
#include <stdio.h>
#include <string.h>

static void set_captured(App *app, bool on) {
    SDL_SetWindowRelativeMouseMode(app->window, on);
    app->input.captured = on;
}

bool app_init(App *app, const char *title, int width, int height) {
    memset(app, 0, sizeof *app);
    if (!SDL_Init(SDL_INIT_VIDEO)) { fprintf(stderr, "SDL_Init: %s\n", SDL_GetError()); return false; }
    SDL_WindowFlags flags = SDL_WINDOW_RESIZABLE | SDL_WINDOW_HIGH_PIXEL_DENSITY;
#if defined(SDL_PLATFORM_MACOS)
    flags |= SDL_WINDOW_METAL;
#endif
    app->window = SDL_CreateWindow(title, width, height, flags);
    if (!app->window) { fprintf(stderr, "SDL_CreateWindow: %s\n", SDL_GetError()); return false; }

    if (!gpu_create_instance(&app->gpu)) return false;
    WGPUSurface surface = create_surface(app->gpu.instance, app->window);
    if (!surface || !gpu_init(&app->gpu, surface)) { fprintf(stderr, "WebGPU init failed\n"); return false; }
    int pw, ph;
    SDL_GetWindowSizeInPixels(app->window, &pw, &ph);   // pixels (Retina: 2x the window size)
    gpu_configure_surface(&app->gpu, (uint32_t)pw, (uint32_t)ph);
    app->input.keys = SDL_GetKeyboardState(NULL);
    app->time = now_seconds();
    return true;
}

bool app_frame(App *app) {
    Input *in = &app->input;
    memset(in->pressed, 0, sizeof in->pressed);
    in->mouse_dx = in->mouse_dy = in->wheel = 0;
    app->resized = false;

    SDL_Event e;
    while (SDL_PollEvent(&e)) {
        switch (e.type) {
        case SDL_EVENT_QUIT: app->quit = true; break;
        case SDL_EVENT_KEY_DOWN:
            if (!e.key.repeat) in->pressed[e.key.scancode] = true;
            if (e.key.scancode == SDL_SCANCODE_ESCAPE && in->captured) set_captured(app, false);
            break;
        case SDL_EVENT_MOUSE_MOTION:
            in->mouse_x = e.motion.x; in->mouse_y = e.motion.y;
            in->mouse_dx += e.motion.xrel; in->mouse_dy += e.motion.yrel;
            break;
        case SDL_EVENT_MOUSE_BUTTON_DOWN:
            if (!in->captured) set_captured(app, true);
            break;
        case SDL_EVENT_MOUSE_WHEEL: in->wheel += e.wheel.y; break;
        case SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED: {
            int pw, ph;
            SDL_GetWindowSizeInPixels(app->window, &pw, &ph);
            if (pw > 0 && ph > 0) { gpu_configure_surface(&app->gpu, (uint32_t)pw, (uint32_t)ph); app->resized = true; }
            break;
        }
        default: break;
        }
    }

    double t = now_seconds();
    app->dt = t - app->time;
    if (app->dt > 0.1) app->dt = 0.1;   // after a stall, don't simulate a huge step
    app->time = t;
    app->frame++;
    gpu_poll(&app->gpu, false);
    return !app->quit;
}

void app_shutdown(App *app) {
    gpu_shutdown(&app->gpu);
    if (app->window) SDL_DestroyWindow(app->window);
    SDL_Quit();
}
