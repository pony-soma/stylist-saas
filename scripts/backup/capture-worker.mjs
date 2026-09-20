// No CLI or production activation. Successful return means staged, never complete.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export async function superviseWorker(lease, startWorker, { afterStaged } = {}) {
  let child, closed = false, failed = false;
  const stop = () => {
    failed = true;
    // Cooperative SIGTERM: Python waits for its current bounded operation,
    // unwinds subprocess/tempfile cleanup, then exits. Never release early.
    if (child && !closed) { try { child.kill('SIGTERM'); } catch { /* Still await close; never unlock early. */ } }
  };
  try {
    if (afterStaged !== undefined && typeof afterStaged !== 'function') throw Error('Invalid continuation');
    await lease.verify();
    lease.signal.addEventListener('abort', stop);
    if (lease.signal.aborted) throw Error('Capture cancelled');
    child = startWorker();
    const code = await new Promise(resolve => {
      child.on('error', () => { failed = true; });
      child.once('close', code => { closed = true; resolve(code); });
      if (lease.signal.aborted) stop();
    });
    if (failed || code !== 0 || lease.signal.aborted) throw Error('Capture worker failed');
    await lease.verify();
    if (lease.signal.aborted) throw Error('Capture cancelled');
    if (afterStaged) {
      // The continuation owns no release capability. Await its cleanup even on
      // cancellation; racing it against abort would unlock while it still runs.
      // It must settle only after its own operations have stopped.
      await afterStaged(Object.freeze({ signal: lease.signal, verify: () => lease.verify() }));
      await lease.verify();
      if (lease.signal.aborted) throw Error('Capture cancelled');
    }
    return { status: 'staged', complete: false, atomic_snapshot: false };
  } catch {
    throw Error('Supervised capture did not complete; staged objects are not a successful backup');
  } finally {
    lease.signal.removeEventListener('abort', stop);
    // startWorker is synchronous spawn; close precedes all normal cleanup here.
    await lease.release();
  }
}

export async function runStagedBackup(lease, { python = 'python3', env = process.env, afterStaged } = {}) {
  if (process.platform !== 'linux') {
    await lease.release();
    throw Error('Cooperative capture workers require the reviewed Linux environment');
  }
  const script = fileURLToPath(new URL('./backup.py', import.meta.url));
  return superviseWorker(lease, () => spawn(python, [script, '--supervised-stage'], {
    env, stdio: 'ignore', shell: false,
  }), { afterStaged });
}
