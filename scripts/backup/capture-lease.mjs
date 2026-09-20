// Experimental supervision only: no CLI, production activation or backup publication.
// The caller must stop and await its workers after signal abort, then release.
// A lease does not freeze Storage bytes, sequences, DDL or external services.
export function superviseCaptureLock(lock, {
  heartbeatMs = 10_000, verificationTimeoutMs = 15_000, maxDurationMs = 15 * 60_000,
} = {}) {
  for (const value of [heartbeatMs, verificationTimeoutMs, maxDurationMs]) {
    if (!Number.isSafeInteger(value) || value <= 0) throw Error('Invalid capture lease limits');
  }
  if (heartbeatMs + verificationTimeoutMs > 60_000 || maxDurationMs > 60 * 60_000 ||
      typeof lock?.verify !== 'function' || typeof lock?.release !== 'function')
    throw Error('Invalid capture lease configuration');
  const controller = new AbortController();
  let failure, closed = false, pending, heartbeat, releasing;
  const invalidate = code => {
    if (!failure) failure = Error(code);
    clearTimeout(heartbeat);
    if (!controller.signal.aborted) controller.abort(failure);
    return failure;
  };
  const deadline = setTimeout(() => invalidate('Capture lease expired'), maxDurationMs);
  function ensureHealthy() {
    if (failure) throw failure;
    if (closed) throw Error('Capture lease released');
  }
  function verify() {
    try { ensureHealthy(); } catch (error) { return Promise.reject(error); }
    if (pending) return pending;
    let watchdog;
    const query = Promise.resolve().then(() => lock.verify());
    pending = Promise.race([
      query,
      new Promise((_, reject) => {
        watchdog = setTimeout(() => reject(Error('timeout')), verificationTimeoutMs);
      }),
    ]).then(() => { ensureHealthy(); }).catch(() => {
      throw invalidate('Capture lock verification failed');
    }).finally(() => { clearTimeout(watchdog); pending = undefined; });
    return pending;
  }
  function tick() {
    if (closed || failure) return;
    void verify().then(() => {
      if (!closed && !failure) heartbeat = setTimeout(tick, heartbeatMs);
    }).catch(() => {});
  }
  tick();
  return {
    tableCount: lock.tableCount,
    signal: controller.signal,
    verify,
    // Deliberately never release on a timer: workers may still be accessing data.
    // Call only after workers have stopped. This is not a migration handoff.
    release() {
      if (releasing) return releasing;
      closed = true;
      clearTimeout(heartbeat);
      clearTimeout(deadline);
      if (!controller.signal.aborted) controller.abort(Error('Capture lease released'));
      releasing = (async () => {
        if (pending) await pending.catch(() => {});
        try { await lock.release(); } catch { throw Error('Capture lock release failed'); }
      })();
      return releasing;
    },
  };
}
