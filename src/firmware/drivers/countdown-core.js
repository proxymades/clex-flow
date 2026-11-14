// The graph worker owns the state. Unsigned subtraction also handles millis() rollover.
export const COUNTDOWN_CORE = String.raw`
typedef struct {
  uint32_t started_ms;
  bool active;
} clex_countdown_t;

static void clex_countdown_begin(clex_countdown_t *state, uint32_t now_ms) {
  state->started_ms = now_ms;
  state->active = true;
}

static void clex_countdown_cancel(clex_countdown_t *state) {
  state->active = false;
}

static bool clex_countdown_expire(clex_countdown_t *state, uint32_t now_ms, uint32_t duration_ms) {
  if (!state->active || (uint32_t)(now_ms - state->started_ms) < duration_ms) {
    return false;
  }
  state->active = false;
  return true;
}
`;
