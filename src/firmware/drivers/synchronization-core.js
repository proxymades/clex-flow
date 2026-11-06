// All state changes run on the existing flow worker, including timeout polling.
export const SYNCHRONIZATION_CORE = String.raw`
typedef struct {
  uint16_t received;
  uint16_t expected;
  uint64_t started_ms;
  bool active;
} clex_sync_t;

static void clex_sync_begin(clex_sync_t *state, unsigned count, uint64_t now) {
  state->received = 0;
  state->expected = (uint16_t)((1UL << count) - 1);
  state->started_ms = now;
  state->active = true;
}

static bool clex_sync_expire(clex_sync_t *state, uint64_t now, uint32_t timeout_ms) {
  if (!state->active || !timeout_ms || now - state->started_ms < timeout_ms) {
    return false;
  }
  state->active = false;
  return true;
}

// 0: ignored or still waiting; 1: completed; 2: timed out.
static unsigned clex_sync_receive(clex_sync_t *state, unsigned slot,
                                  uint64_t now, uint32_t timeout_ms) {
  if (clex_sync_expire(state, now, timeout_ms)) {
    return 2;
  }
  if (!state->active || slot >= 16) {
    return 0;
  }
  uint16_t bit = (uint16_t)(1UL << slot);
  if (!(state->expected & bit) || (state->received & bit)) {
    return 0;
  }
  state->received |= bit;
  if (state->received != state->expected) {
    return 0;
  }
  state->active = false;
  return 1;
}
`;
