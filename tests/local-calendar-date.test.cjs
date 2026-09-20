const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const ts = require('typescript');

const code = ts.transpileModule(fs.readFileSync('lib/utils.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

for (const [timezone, instant, expected] of [
  ['Asia/Tokyo', '2026-09-20T17:38:00Z', '2026-09-21'],
  ['Asia/Tokyo', '2025-12-31T15:00:00Z', '2026-01-01'],
  ['Asia/Tokyo', '2024-02-28T15:00:00Z', '2024-02-29'],
  ['America/Los_Angeles', '2026-09-21T02:00:00Z', '2026-09-20'],
  ['UTC', '2026-09-21T00:00:00Z', '2026-09-21'],
]) {
  test(`calendar date at ${instant} in ${timezone}`, () => {
    const script = `${code}\nprocess.stdout.write(exports.formatLocalDateInput(new Date(${JSON.stringify(instant)})));`;
    const result = execFileSync(process.execPath, ['-e', script], {
      env: { ...process.env, TZ: timezone }, encoding: 'utf8',
    });
    assert.equal(result, expected);
  });
}
