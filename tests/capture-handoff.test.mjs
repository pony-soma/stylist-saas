import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { superviseWorker } from '../scripts/backup/capture-worker.mjs';
import { superviseCaptureLock } from '../scripts/backup/capture-lease.mjs';
const tick = () => new Promise(r => setImmediate(r));
function fixture() {
  const events = [], controller = new AbortController(), child = new EventEmitter();
  child.kill = () => events.push('kill');
  const lease = {
    signal: controller.signal,
    async verify() { if (controller.signal.aborted) throw Error('secret'); events.push('verify'); },
    async release() { events.push('release'); },
  };
  return { events, controller, child, lease };
}
test('continuation retains lease until settlement and cannot declare backup complete', async () => {
  const f = fixture(); let finish;
  const run = superviseWorker(f.lease, () => f.child, { afterStaged: async context => {
    assert.equal(context.release, undefined);
    assert.equal(Object.isFrozen(context), true);
    f.events.push('handoff');
    await new Promise(r => { finish = r; });
    return { complete: true };
  } });
  await tick(); f.child.emit('close', 0); await tick();
  assert.deepEqual(f.events, ['verify', 'verify', 'handoff']);
  finish();
  assert.deepEqual(await run, { status: 'staged', complete: false, atomic_snapshot: false });
  assert.deepEqual(f.events, ['verify', 'verify', 'handoff', 'verify', 'release']);
});
test('abort during continuation waits for its cleanup before release', async () => {
  const f = fixture(); let finish;
  const run = superviseWorker(f.lease, () => f.child, { afterStaged: async ({ signal }) => {
    await new Promise(r => { finish = r; });
    assert.equal(signal.aborted, true); f.events.push('cleanup');
  } });
  const rejected = assert.rejects(run, /did not complete/);
  await tick(); f.child.emit('close', 0); await tick();
  f.controller.abort(); await tick();
  assert.equal(f.events.includes('release'), false);
  assert.equal(f.events.includes('kill'), false);
  finish(); await rejected;
  assert.deepEqual(f.events.slice(-2), ['cleanup', 'release']);
});
test('failed continuation is sanitized and lease released once', async () => {
  const f = fixture();
  const run = superviseWorker(f.lease, () => f.child, { afterStaged: async () => { throw Error('private credentials'); } });
  const rejected = assert.rejects(run, e => /did not complete/.test(e.message) && !e.message.includes('credentials'));
  await tick(); f.child.emit('close', 0); await rejected;
  assert.equal(f.events.filter(e => e === 'release').length, 1);
});
test('failed backup never invokes continuation', async () => {
  const f = fixture(); let invoked = false;
  const run = superviseWorker(f.lease, () => f.child, { afterStaged: async () => { invoked = true; } });
  const rejected = assert.rejects(run, /did not complete/);
  await tick(); f.child.emit('close', 1); await rejected;
  assert.equal(invoked, false);
});
test('real lease deadline cancels continuation and waits for cleanup', async () => {
  const events = [], child = new EventEmitter();
  child.kill = () => { throw Error('already closed worker must not be killed'); };
  const lease = superviseCaptureLock({ tableCount: 10,
    async verify() { events.push('heartbeat'); },
    async release() { events.push('release'); },
  }, { heartbeatMs: 5, verificationTimeoutMs: 10, maxDurationMs: 100 });
  const run = superviseWorker(lease, () => child, { afterStaged: async ({ signal }) => {
    events.push('handoff');
    await new Promise(resolve => {
      if (signal.aborted) resolve();
      else signal.addEventListener('abort', resolve, { once: true });
    });
    assert.equal(events.includes('release'), false);
    await new Promise(resolve => setTimeout(resolve, 15));
    events.push('cleanup');
  } });
  const rejected = assert.rejects(run, /did not complete/);
  await tick(); child.emit('close', 0); await rejected;
  assert.ok(events.indexOf('handoff') >= 0);
  assert.ok(events.slice(events.indexOf('handoff') + 1).includes('heartbeat'));
  assert.deepEqual(events.slice(-2), ['cleanup', 'release']);
});
