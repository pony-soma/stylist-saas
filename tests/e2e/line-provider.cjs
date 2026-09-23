// Mock only LINE's external provider; the application API, Auth and DB are real.
if (process.env.VERCEL || process.env.LINO_E2E_LOCAL !== '1' || process.env.NEXT_PUBLIC_BASE_URL !== 'http://localhost:3000' || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') {
  throw new Error('Refusing synthetic LINE provider outside isolated E2E');
}
process.env.LINE_LOGIN_CHANNEL_ID = 'e2e-line-channel';
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url || input.toString());
  if (url.hostname !== 'api.line.me') return realFetch(input, init);
  const token = url.searchParams.get('access_token') || new Headers(init?.headers).get('authorization')?.replace(/^Bearer /, '');
  if (!/^e2e-line-[0-9a-f]{32}$/.test(token || '')) return Response.json({}, { status: 401 });
  if (url.pathname === '/oauth2/v2.1/verify') return Response.json({ client_id: 'e2e-line-channel', expires_in: 300 });
  if (url.pathname === '/v2/profile') return Response.json({ userId: 'U' + token.slice(9), displayName: '予約テストのお客様' });
  throw new Error('Unexpected external LINE API in E2E');
};
