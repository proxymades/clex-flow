// Time is supplied by the caller; all state belongs to the graph worker.
export const STOPWATCH_RUNTIME = String.raw`typedef struct {
  int64_t elapsed_us;
  int64_t started_us;
  uint64_t seconds;
  bool running;
  bool dirty;
  char text[32];
} clex_stopwatch_t;

static int64_t clex_stopwatch_elapsed(const clex_stopwatch_t *watch, int64_t now_us) {
  int64_t delta = watch->running && now_us >= watch->started_us ? now_us - watch->started_us : 0;
  return delta > INT64_MAX - watch->elapsed_us ? INT64_MAX : watch->elapsed_us + delta;
}
static void clex_stopwatch_initialize(clex_stopwatch_t *watch, bool auto_start, int64_t now_us) {
  memset(watch, 0, sizeof(*watch));
  watch->running = auto_start;
  watch->started_us = now_us;
  watch->dirty = true;
  snprintf(watch->text, sizeof(watch->text), "00:00:00");
}
static bool clex_stopwatch_refresh(clex_stopwatch_t *watch, int64_t now_us) {
  uint64_t seconds = (uint64_t)(clex_stopwatch_elapsed(watch, now_us) / 1000000);
  if (!watch->dirty && watch->seconds == seconds) return false;
  watch->seconds = seconds;
  snprintf(watch->text, sizeof(watch->text), "%02llu:%02llu:%02llu",
    (unsigned long long)(seconds / 3600),
    (unsigned long long)((seconds / 60) % 60),
    (unsigned long long)(seconds % 60));
  watch->dirty = false;
  return true;
}
static bool clex_stopwatch_start(clex_stopwatch_t *watch, int64_t now_us) {
  if (!watch->running) {
    watch->started_us = now_us;
    watch->running = true;
    watch->dirty = true;
  }
  return clex_stopwatch_refresh(watch, now_us);
}
static bool clex_stopwatch_pause(clex_stopwatch_t *watch, int64_t now_us) {
  if (watch->running) {
    watch->elapsed_us = clex_stopwatch_elapsed(watch, now_us);
    watch->running = false;
    watch->dirty = true;
  }
  return clex_stopwatch_refresh(watch, now_us);
}
static bool clex_stopwatch_reset(clex_stopwatch_t *watch, int64_t now_us) {
  watch->elapsed_us = 0;
  watch->started_us = now_us;
  watch->dirty = true;
  return clex_stopwatch_refresh(watch, now_us);
}
`;
