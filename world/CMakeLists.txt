cmake_minimum_required(VERSION 3.24)
project(world C CXX)

set(CMAKE_C_STANDARD 17)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE RelWithDebInfo)
endif()

# DAWN: Google's implementation (what Chrome uses), built from source once (slow first build).
# WGPU: wgpu-native prebuilt library, same C API (webgpu.h), downloads in seconds.
set(WORLD_WEBGPU "DAWN" CACHE STRING "WebGPU implementation: DAWN or WGPU")
set_property(CACHE WORLD_WEBGPU PROPERTY STRINGS DAWN WGPU)
# Headless-only builds (no window, no GLFW): engine library and tests. Used for CI.
option(WORLD_HEADLESS "Build only the headless engine and tests" OFF)
option(WORLD_SANITIZE "Build with AddressSanitizer and UBSan" OFF)

include(FetchContent)
include(cmake/webgpu.cmake)

if(WORLD_SANITIZE)
  add_compile_options(-fsanitize=address,undefined -fno-omit-frame-pointer)
  add_link_options(-fsanitize=address,undefined)
endif()

# Every engine/*.c except the windowing layer goes into the engine library.
file(GLOB ENGINE_SOURCES CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/engine/*.c)
list(FILTER ENGINE_SOURCES EXCLUDE REGEX "/(app|surface)\\.c$")
add_library(engine STATIC ${ENGINE_SOURCES})
target_include_directories(engine PUBLIC engine)
target_link_libraries(engine PUBLIC webgpu m)
target_compile_definitions(engine PUBLIC WORLD_SHADER_DIR="${CMAKE_CURRENT_SOURCE_DIR}/shaders/" ${WORLD_WEBGPU_DEFINE})
target_compile_options(engine PUBLIC -Wall -Wextra -Wno-unused-parameter)

enable_testing()
file(GLOB TEST_SOURCES CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/tests/*.c)
add_executable(world_tests ${TEST_SOURCES})
target_link_libraries(world_tests PRIVATE engine)
add_test(NAME world_tests COMMAND world_tests)
world_copy_runtime(world_tests)

if(NOT WORLD_HEADLESS)
  FetchContent_Declare(SDL3
    GIT_REPOSITORY https://github.com/libsdl-org/SDL GIT_TAG release-3.4.8 GIT_SHALLOW TRUE)
  set(SDL_SHARED OFF CACHE BOOL "" FORCE)
  set(SDL_STATIC ON CACHE BOOL "" FORCE)
  set(SDL_TEST_LIBRARY OFF CACHE BOOL "" FORCE)
  set(SDL_EXAMPLES OFF CACHE BOOL "" FORCE)
  FetchContent_MakeAvailable(SDL3)

  add_library(app STATIC engine/app.c engine/surface.c)
  target_link_libraries(app PUBLIC engine SDL3::SDL3)

  # One executable per chapter demo: apps/NN-name.c
  file(GLOB WORLD_APPS CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/apps/*.c)
  foreach(src ${WORLD_APPS})
    get_filename_component(name ${src} NAME_WE)
    add_executable(${name} ${src})
    target_link_libraries(${name} PRIVATE app)
    world_copy_runtime(${name})
  endforeach()

  # Local exercise starters: exercises/NN-name/*.c → executable ex-NN-name
  file(GLOB WORLD_EXERCISES LIST_DIRECTORIES true ${CMAKE_CURRENT_SOURCE_DIR}/exercises/*)
  foreach(dir ${WORLD_EXERCISES})
    if(IS_DIRECTORY ${dir})
      get_filename_component(name ${dir} NAME)
      file(GLOB ex_sources CONFIGURE_DEPENDS ${dir}/*.c)
      add_executable(ex-${name} ${ex_sources})
      target_include_directories(ex-${name} PRIVATE ${dir})
      target_link_libraries(ex-${name} PRIVATE app)
      world_copy_runtime(ex-${name})
    endif()
  endforeach()
endif()
