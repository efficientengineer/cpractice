# Provides an imported target `webgpu` (headers + library) for the chosen implementation,
# the define WORLD_WEBGPU_DAWN or WORLD_WEBGPU_WGPU, and world_copy_runtime(target).

# Reuse an already-built Dawn instead of building it inside this build directory:
#   -DWORLD_DAWN_SOURCE=/path/to/dawn -DWORLD_DAWN_BUILD=/path/to/dawn/out
set(WORLD_DAWN_SOURCE "" CACHE PATH "Dawn source checkout (optional, with WORLD_DAWN_BUILD)")
set(WORLD_DAWN_BUILD "" CACHE PATH "Dawn build directory containing libwebgpu_dawn (optional)")

if(WORLD_WEBGPU STREQUAL "DAWN" AND WORLD_DAWN_BUILD)
  set(WORLD_WEBGPU_DEFINE WORLD_WEBGPU_DAWN)
  find_library(WORLD_DAWN_LIB NAMES webgpu_dawn PATHS ${WORLD_DAWN_BUILD}/src/dawn/native NO_DEFAULT_PATH REQUIRED)
  add_library(webgpu SHARED IMPORTED GLOBAL)
  set_target_properties(webgpu PROPERTIES IMPORTED_LOCATION ${WORLD_DAWN_LIB}
    INTERFACE_INCLUDE_DIRECTORIES "${WORLD_DAWN_SOURCE}/include;${WORLD_DAWN_BUILD}/gen/include")
  get_filename_component(WORLD_DAWN_LIBDIR ${WORLD_DAWN_LIB} DIRECTORY)
  function(world_copy_runtime target)
    set_target_properties(${target} PROPERTIES BUILD_RPATH ${WORLD_DAWN_LIBDIR})
  endfunction()

elseif(WORLD_WEBGPU STREQUAL "DAWN")
  set(WORLD_WEBGPU_DEFINE WORLD_WEBGPU_DAWN)
  # Pinned Dawn release. Dependencies are fetched by Dawn's own script on first configure.
  FetchContent_Declare(dawn
    GIT_REPOSITORY https://github.com/google/dawn
    GIT_TAG v20261016.190333
    GIT_SHALLOW TRUE)
  set(DAWN_FETCH_DEPENDENCIES ON CACHE BOOL "" FORCE)
  set(DAWN_BUILD_MONOLITHIC_LIBRARY SHARED CACHE STRING "" FORCE)
  set(DAWN_BUILD_SAMPLES OFF CACHE BOOL "" FORCE)
  set(DAWN_BUILD_TESTS OFF CACHE BOOL "" FORCE)
  set(DAWN_BUILD_PROTOBUF OFF CACHE BOOL "" FORCE)
  set(DAWN_ENABLE_INSTALL OFF CACHE BOOL "" FORCE)
  set(DAWN_USE_GLFW OFF CACHE BOOL "" FORCE)
  set(DAWN_SUPPORTS_CXX_MODULES OFF CACHE BOOL "" FORCE)
  set(CMAKE_CXX_SCAN_FOR_MODULES OFF CACHE BOOL "" FORCE)
  set(DAWN_ENABLE_OPENGLES OFF CACHE BOOL "" FORCE)
  set(DAWN_ENABLE_DESKTOP_GL OFF CACHE BOOL "" FORCE)
  set(TINT_BUILD_TESTS OFF CACHE BOOL "" FORCE)
  set(TINT_BUILD_CMD_TOOLS OFF CACHE BOOL "" FORCE)
  set(TINT_BUILD_IR_BINARY OFF CACHE BOOL "" FORCE)
  if(WORLD_HEADLESS)
    set(DAWN_USE_X11 OFF CACHE BOOL "" FORCE)
    set(DAWN_USE_WAYLAND OFF CACHE BOOL "" FORCE)
  endif()
  FetchContent_MakeAvailable(dawn)
  add_library(webgpu INTERFACE)
  target_link_libraries(webgpu INTERFACE webgpu_dawn)
  function(world_copy_runtime target)
  endfunction()

elseif(WORLD_WEBGPU STREQUAL "WGPU")
  set(WORLD_WEBGPU_DEFINE WORLD_WEBGPU_WGPU)
  set(WGPU_VERSION v25.0.2.1)
  if(APPLE)
    if(CMAKE_SYSTEM_PROCESSOR MATCHES "arm64|aarch64")
      set(WGPU_PLATFORM macos-aarch64)
    else()
      set(WGPU_PLATFORM macos-x86_64)
    endif()
    set(WGPU_LIB libwgpu_native.dylib)
  elseif(WIN32)
    set(WGPU_PLATFORM windows-x86_64-msvc)
    set(WGPU_LIB wgpu_native.dll.lib)
  else()
    set(WGPU_PLATFORM linux-x86_64)
    set(WGPU_LIB libwgpu_native.so)
  endif()
  FetchContent_Declare(wgpu_native
    URL https://github.com/gfx-rs/wgpu-native/releases/download/${WGPU_VERSION}/wgpu-${WGPU_PLATFORM}-release.zip
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
  FetchContent_MakeAvailable(wgpu_native)
  add_library(webgpu SHARED IMPORTED GLOBAL)
  set_target_properties(webgpu PROPERTIES
    IMPORTED_LOCATION ${wgpu_native_SOURCE_DIR}/lib/${WGPU_LIB}
    IMPORTED_IMPLIB ${wgpu_native_SOURCE_DIR}/lib/${WGPU_LIB}
    INTERFACE_INCLUDE_DIRECTORIES ${wgpu_native_SOURCE_DIR}/include)
  if(APPLE)
    set_target_properties(webgpu PROPERTIES IMPORTED_SONAME @rpath/libwgpu_native.dylib)
  elseif(NOT WIN32)
    set_target_properties(webgpu PROPERTIES IMPORTED_NO_SONAME TRUE)  # the .so has no SONAME; link by name, find via rpath
  endif()
  function(world_copy_runtime target)
    set_target_properties(${target} PROPERTIES BUILD_RPATH ${wgpu_native_SOURCE_DIR}/lib)
  endfunction()

else()
  message(FATAL_ERROR "WORLD_WEBGPU must be DAWN or WGPU")
endif()
