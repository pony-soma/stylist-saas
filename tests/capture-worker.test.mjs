import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { superviseWorker } from '../scripts/backup/capture-worker.mjs';

function fixture() {
  const events = [], controller = new AbortController(), child = new EventEmitter();
  child.kill = () => { events.push('stop'); return true; };
  const lease = { signal: controller.signal, async verify() { if (controller.signal.aborted) throw Error('private'); events.push('verify'); }, async release() { events.push('release'); } };
  return { events, controller, child, lease };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('success is staged only and is checked before releasing', async () => {
  const f = fixture(), result = superviseWorker(f.lease, () => f.child);
  await tick(); f.child.emit('close', 0);
  assert.deepEqual(await result, { status: 'staged', complete: false, atomic_snapshot: false });
  assert.deepEqual(f.events, ['verify', 'verify', 'release']);
});
test('abort requests stop but waits for worker close before unlocking', async () => {
  const f = fixture(), result = superviseWorker(f.lease, () => f.child);
  const rejected = assert.rejects(result, /did not complete/);
  await tick(); f.controller.abort(); await tick();
  assert.deepEqual(f.events, ['verify', 'stop']);
  f.child.emit('close', 1); await rejected;
  assert.deepEqual(f.events, ['verify', 'stop', 'release']);
});
test('zero exit after cancellation cannot become success', async () => {
  const f = fixture(), result = superviseWorker(f.lease, () => f.child);
  const rejected = assert.rejects(result, /did not complete/);
  await tick(); f.controller.abort(); f.child.emit('close', 0); await rejected;
});
test('worker errors are sanitized and close is awaited', async () => {
  const f = fixture(), result = superviseWorker(f.lease, () => f.child);
  const rejected = assert.rejects(result, /did not complete/);
  await tick(); f.child.emit('error', Error('credential details')); await tick();
  assert.equal(f.events.includes('release'), false);
  f.child.emit('close', -1); await rejected;
});
test('failed initial verification does not launch a worker', async () => {
  const f = fixture(); f.controller.abort();
  await assert.rejects(superviseWorker(f.lease, () => { throw Error('must not start'); }), /did not complete/);
  assert.deepEqual(f.events, ['release']);
});
test('loss during final verification refuses success', async () => {
  const f = fixture(); let checks = 0;
  f.lease.verify = async () => { if (++checks === 2) throw Error('private'); };
  const result = superviseWorker(f.lease, () => f.child);
  const rejected = assert.rejects(result, /did not complete/);
  await tick(); f.child.emit('close', 0); await rejected;
});
test('real Linux worker exits cooperatively before lock release', { skip: process.platform !== 'linux' }, async () => {
  const f = fixture(); let child;
  const result = superviseWorker(f.lease, () => {
    child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>setTimeout(()=>process.exit(0),40));process.stdout.write('READY');setInterval(()=>{},1000)"], { stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.once('data', () => f.controller.abort());
    child.once('close', () => f.events.push('worker-closed'));
    return child;
  });
  const watchdog = setTimeout(() => child?.kill('SIGKILL'), 5000);
  try {
    await assert.rejects(result, /did not complete/);
    assert.equal(f.controller.signal.aborted, true);
    assert.ok(f.events.indexOf('worker-closed') < f.events.indexOf('release'));
  } finally { clearTimeout(watchdog); }
});
