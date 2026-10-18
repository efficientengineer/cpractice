#pragma once
#include <stddef.h>
#include <stdint.h>

// Reads a whole file into a malloc'd, NUL-terminated buffer. Returns NULL on failure.
char *read_file(const char *path, size_t *len);
// Monotonic time in seconds.
double now_seconds(void);
