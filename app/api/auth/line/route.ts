import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET() {
  // Stylist notifications must use the Messaging API's provider. Customer
  // LIFF authentication keeps its existing LINE_LOGIN_CHANNEL_ID separately.
  const notificationLoginConfigured = Boolean(process.env.LINE_NOTIFICATION_LOGIN_CHANNEL_ID || process.env.LINE_NOTIFICATION_LOGIN_CHANNEL_SECRET);
  const channelId = notificationLoginConfigured
    ? process.env.LINE_NOTIFICATION_LOGIN_CHANNEL_ID
    : process.env.LINE_LOGIN_CHANNEL_ID;
  const channelSecret = notificationLoginConfigured
    ? process.env.LINE_NOTIFICATION_LOGIN_CHANNEL_SECRET
    : process.env.LINE_LOGIN_CHANNEL_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const callbackUrl = `${appUrl}/api/auth/line/callback`;
  
  if (!channelId || !channelSecret) {
    return NextResponse.json({ error: 'LINE login credentials are not configured' }, { status: 500 });
  }

  // CSRF対策のためのstateパラメータを生成
  const state = Math.random().toString(36).substring(2, 15);
  
  // cookies() を awaiting せずにそのまま使用 (Next.js 14以下対応)
  // もしNext.js 15+であれば await cookies() が必要になる場合がありますが、現状のApp Router仕様に合わせます
  cookies().set('line_oauth_state', state, { 
    httpOnly: true, 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 10, // 10 minutes
    path: '/'
  });

  const lineAuthUrl = new URL('https://access.line.me/oauth2/v2.1/authorize');
  lineAuthUrl.searchParams.append('response_type', 'code');
  lineAuthUrl.searchParams.append('client_id', channelId);
  lineAuthUrl.searchParams.append('redirect_uri', callbackUrl);
  lineAuthUrl.searchParams.append('state', state);
  lineAuthUrl.searchParams.append('scope', 'profile openid');

  return NextResponse.redirect(lineAuthUrl.toString());
}
