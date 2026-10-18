// Runs all registered tests, or only those whose name contains argv[1].
#include "test.h"
#include <string.h>

#define MAX_TESTS 1024
static struct { const char *name; TestFn fn; } tests[MAX_TESTS];
static int test_count;
int test_failures;

void test_register(const char *name, TestFn fn) {
    if (test_count < MAX_TESTS) { tests[test_count].name = name; tests[test_count].fn = fn; test_count++; }
}

int main(int argc, char **argv) {
    int run = 0, failed = 0;
    for (int i = 0; i < test_count; i++) {
        if (argc > 1 && !strstr(tests[i].name, argv[1])) continue;
        int before = test_failures;
        tests[i].fn();
        run++;
        if (test_failures > before) { failed++; printf("FAIL %s\n", tests[i].name); }
        else printf("ok   %s\n", tests[i].name);
    }
    printf("%d tests, %d failed\n", run, failed);
    return failed != 0;
}
