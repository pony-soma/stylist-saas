export class LineBookingAuthError extends Error {}

// Never trust browser-supplied profile IDs; verify both token audience and expiry.
export async function verifiedLineProfile(request: Request) {
  const header = request.headers.get('authorization');
  const channel = process.env.LINE_LOGIN_CHANNEL_ID;
  if (!channel) throw new Error('LINE configuration unavailable');
  if (!header?.startsWith('Bearer ') || header.length > 4096 || header.length < 8) throw new LineBookingAuthError();
  const token = header.slice(7);
  const verification = await fetch(`https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(token)}`, {
    cache: 'no-store', signal: AbortSignal.timeout(8000),
  });
  if (!verification.ok) throw new LineBookingAuthError();
  const verified = await verification.json();
  if (verified.client_id !== channel || typeof verified.expires_in !== 'number' || verified.expires_in <= 0) throw new LineBookingAuthError();
  const response = await fetch('https://api.line.me/v2/profile', {
    headers: { Authorization: header }, cache: 'no-store', signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new LineBookingAuthError();
  const profile = await response.json();
  if (typeof profile.userId !== 'string' || !/^U[0-9a-f]{32}$/i.test(profile.userId) ||
      typeof profile.displayName !== 'string' || !profile.displayName.trim()) throw new LineBookingAuthError();
  return { userId: profile.userId as string, displayName: Array.from(profile.displayName.trim()).slice(0, 50).join('') };
}
