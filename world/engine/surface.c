// WGPUSurface from an SDL3 window, per platform. No Objective-C needed on macOS: SDL creates the
// Metal view and gives us its CAMetalLayer.
#include "app.h"
#include <stdio.h>

WGPUSurface create_surface(WGPUInstance instance, SDL_Window *window) {
    WGPUSurfaceDescriptor desc = { .label = SV("window") };
#if defined(SDL_PLATFORM_MACOS)
    SDL_MetalView view = SDL_Metal_CreateView(window);
    WGPUSurfaceSourceMetalLayer src = { .chain.sType = WGPUSType_SurfaceSourceMetalLayer, .layer = SDL_Metal_GetLayer(view) };
    desc.nextInChain = &src.chain;
    return wgpuInstanceCreateSurface(instance, &desc);
#elif defined(SDL_PLATFORM_WIN32)
    SDL_PropertiesID props = SDL_GetWindowProperties(window);
    WGPUSurfaceSourceWindowsHWND src = { .chain.sType = WGPUSType_SurfaceSourceWindowsHWND,
        .hinstance = SDL_GetPointerProperty(props, SDL_PROP_WINDOW_WIN32_INSTANCE_POINTER, NULL),
        .hwnd = SDL_GetPointerProperty(props, SDL_PROP_WINDOW_WIN32_HWND_POINTER, NULL) };
    desc.nextInChain = &src.chain;
    return wgpuInstanceCreateSurface(instance, &desc);
#elif defined(SDL_PLATFORM_LINUX)
    SDL_PropertiesID props = SDL_GetWindowProperties(window);
    if (SDL_strcmp(SDL_GetCurrentVideoDriver(), "wayland") == 0) {
        WGPUSurfaceSourceWaylandSurface src = { .chain.sType = WGPUSType_SurfaceSourceWaylandSurface,
            .display = SDL_GetPointerProperty(props, SDL_PROP_WINDOW_WAYLAND_DISPLAY_POINTER, NULL),
            .surface = SDL_GetPointerProperty(props, SDL_PROP_WINDOW_WAYLAND_SURFACE_POINTER, NULL) };
        desc.nextInChain = &src.chain;
        return wgpuInstanceCreateSurface(instance, &desc);
    }
    WGPUSurfaceSourceXlibWindow src = { .chain.sType = WGPUSType_SurfaceSourceXlibWindow,
        .display = SDL_GetPointerProperty(props, SDL_PROP_WINDOW_X11_DISPLAY_POINTER, NULL),
        .window = (uint64_t)SDL_GetNumberProperty(props, SDL_PROP_WINDOW_X11_WINDOW_NUMBER, 0) };
    desc.nextInChain = &src.chain;
    return wgpuInstanceCreateSurface(instance, &desc);
#else
    fprintf(stderr, "no WebGPU surface support for this platform\n");
    return NULL;
#endif
}
