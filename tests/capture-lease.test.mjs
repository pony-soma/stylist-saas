import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { superviseCaptureLock } from '../scripts/backup/capture-lease.mjs';

const options = { heartbeatMs: 10, verificationTimeoutMs: 100, maxDurationMs: 2000 };
const untilAbort = lease => lease.signal.aborted ? Promise.resolve() :
  new Promise(resolve => lease.signal.addEventListener('abort', resolve, { once: true }));
function fake(verify = async () => {}) {
  let releases = 0;
  return { lock: { tableCount: 4, verify, async release() { releases++; } }, released: () => releases };
}

test('heartbeat keeps checking without caller activity, release is idempotent', async () => {
  let checks = 0;
  const f = fake(async () => { checks++; });
  const lease = superviseCaptureLock(f.lock, options);
  try {
    await delay(60);
    assert.ok(checks >= 2);
    assert.equal(lease.signal.aborted, false);
    await Promise.all([lease.release(), lease.release()]);
    const stopped = checks;
    await delay(30);
    assert.equal(checks, stopped);
    assert.equal(f.released(), 1);
    await assert.rejects(lease.verify());
  } finally { await lease.release(); }
});

test('concurrent final and heartbeat checks never overlap', async () => {
  let active = 0, maximum = 0;
  const f = fake(async () => { maximum = Math.max(maximum, ++active); await delay(20); active--; });
  const lease = superviseCaptureLock(f.lock, options);
  try {
    await Promise.all(Array.from({ length: 12 }, () => lease.verify()));
    assert.equal(maximum, 1);
  } finally { await lease.release(); }
});

test('lock loss aborts permanently and never unlocks before worker cleanup', async () => {
  let lost = false;
  const f = fake(async () => { if (lost) throw Error('secret connection details'); });
  const lease = superviseCaptureLock(f.lock, options);
  try {
    await lease.verify(); lost = true;
    await untilAbort(lease);
    assert.equal(f.released(), 0);
    lost = false;
    await assert.rejects(lease.verify(), /Capture lock verification failed/);
    assert.doesNotMatch(lease.signal.reason.message, /secret/);
  } finally { await lease.release(); }
});

test('healthy heartbeats cannot extend the overall deadline', async () => {
  const f = fake();
  const lease = superviseCaptureLock(f.lock, { ...options, maxDurationMs: 40 });
  try {
    await untilAbort(lease);
    assert.match(lease.signal.reason.message, /expired/);
    assert.equal(f.released(), 0);
    await assert.rejects(lease.verify());
  } finally { await lease.release(); }
});

test('hung verification times out, late success cannot revive lease', async () => {
  let finish;
  const f = fake(() => new Promise(resolve => { finish = resolve; }));
  const lease = superviseCaptureLock(f.lock, { ...options, verificationTimeoutMs: 20 });
  try {
    await untilAbort(lease);
    finish(); await delay(1);
    await assert.rejects(lease.verify(), /verification failed/);
    assert.equal(f.released(), 0);
  } finally { await lease.release(); }
});

test('initial verification failure is observable before any worker starts', async () => {
  const f = fake(async () => { throw Error('private SQL'); });
  const lease = superviseCaptureLock(f.lock, options);
  try { await assert.rejects(lease.verify(), /verification failed/); assert.equal(lease.signal.aborted, true); }
  finally { await lease.release(); }
});

test('release errors are not suppressed or leaked', async () => {
  const lease = superviseCaptureLock({ verify: async () => {}, release: async () => { throw Error('private SQL'); } }, options);
  await lease.verify();
  await assert.rejects(lease.release(), { message: 'Capture lock release failed' });
});

test('unsafe intervals and unlimited lifetimes are refused', () => {
  const f = fake();
  for (const setting of [{ heartbeatMs: 90000 }, { maxDurationMs: Infinity }, { maxDurationMs: 3600001 }, { verificationTimeoutMs: 0 }]) {
    assert.throws(() => superviseCaptureLock(f.lock, { ...options, ...setting }), /Invalid/);
  }
});
