import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

if (process.env.LINO_E2E_LOCAL !== '1' || !process.env.GITHUB_ENV) {
  throw new Error('Only the isolated GitHub Actions job can export local test keys');
}
const status = JSON.parse(execFileSync('npx', ['--no-install', 'supabase', 'status', '--workdir', 'tests/e2e', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
if (status.API_URL !== 'http://127.0.0.1:54321' || !status.ANON_KEY || !status.SERVICE_ROLE_KEY) {
  throw new Error('Unexpected local Supabase status');
}
for (const value of [status.ANON_KEY, status.SERVICE_ROLE_KEY]) {
  if (/[\r\n]/.test(value)) throw new Error('Invalid local key');
  console.log(`::add-mask::${value}`);
}
appendFileSync(process.env.GITHUB_ENV, [
  `NEXT_PUBLIC_SUPABASE_URL=${status.API_URL}`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY=${status.ANON_KEY}`,
  `SUPABASE_SERVICE_ROLE_KEY=${status.SERVICE_ROLE_KEY}`,
  '',
].join('\n'));
