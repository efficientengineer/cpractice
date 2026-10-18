// Minimal test framework: TEST(name) registers a function; CHECK records failures.
#pragma once
#include <math.h>
#include <stdio.h>

typedef void (*TestFn)(void);
void test_register(const char *name, TestFn fn);
extern int test_failures;

#define TEST(name) static void name(void); \
    __attribute__((constructor)) static void reg_##name(void) { test_register(#name, name); } \
    static void name(void)
#define CHECK(c) do { if (!(c)) { test_failures++; printf("  FAIL %s:%d: %s\n", __FILE__, __LINE__, #c); } } while (0)
#define CHECK_NEAR(a, b, eps) do { double a_ = (a), b_ = (b); if (fabs(a_ - b_) > (eps)) { test_failures++; \
    printf("  FAIL %s:%d: %s = %g, expected %g\n", __FILE__, __LINE__, #a, a_, b_); } } while (0)
