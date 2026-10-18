// Shared by the browser and tools/verify.mjs: turns user code + exercise into one C file.
(function (g) {
  const PRELUDE = String.raw`
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <math.h>
static int t_fails_ = 0, t_checks_ = 0;
__attribute__((constructor)) static void t_init_(void) { setvbuf(stdout, NULL, _IONBF, 0); }
#define CHECK(c) do { t_checks_++; if (!(c)) { t_fails_++; printf("FAIL (tests.c:%d): CHECK(%s)\n", __LINE__, #c); } } while (0)
#define CHECK_INT(got, want) do { long long g_ = (long long)(got), w_ = (long long)(want); t_checks_++; \
  if (g_ != w_) { t_fails_++; printf("FAIL (tests.c:%d): %s gave %lld, expected %lld\n", __LINE__, #got, g_, w_); } } while (0)
#define CHECK_UINT(got, want) do { unsigned long long g_ = (unsigned long long)(got), w_ = (unsigned long long)(want); t_checks_++; \
  if (g_ != w_) { t_fails_++; printf("FAIL (tests.c:%d): %s gave %llu (0x%llx), expected %llu (0x%llx)\n", __LINE__, #got, g_, g_, w_, w_); } } while (0)
#define CHECK_DBL(got, want) do { double g_ = (double)(got), w_ = (double)(want); t_checks_++; \
  if (fabs(g_ - w_) > 1e-6 * (1 + fabs(w_))) { t_fails_++; printf("FAIL (tests.c:%d): %s gave %g, expected %g\n", __LINE__, #got, g_, w_); } } while (0)
#define CHECK_STR(got, want) do { const char *g_ = (got), *w_ = (want); t_checks_++; \
  if (!g_ || strcmp(g_, w_) != 0) { t_fails_++; printf("FAIL (tests.c:%d): %s gave \"%s\", expected \"%s\"\n", __LINE__, #got, g_ ? g_ : "(null)", w_); } } while (0)
#define TEST_END() (t_fails_ ? (printf("%d of %d checks failed\n", t_fails_, t_checks_), 1) : (printf("ALL TESTS PASSED (%d checks)\n", t_checks_), 0))
`;
  function harness(user, ex) {
    return '#define main user_main_\n#line 1 "main.c"\n' + user + '\n#undef main\n' + PRELUDE + '\n#line 1 "tests.c"\n' + ex.harness + '\n';
  }
  function passed(res) {
    return res.didExecute && res.exit === 0 && /ALL TESTS PASSED/.test(res.stdout);
  }
  const norm = s => (s || '').replace(/\r/g, '').split('\n').map(l => l.replace(/\s+$/, '')).join('\n').replace(/\n+$/, '');
  g.Assemble = { PRELUDE, harness, passed, norm };
})(typeof window !== 'undefined' ? window : globalThis);
