import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  
  if (errorParam || !code || !state) {
    return NextResponse.redirect(`${appUrl}/admin/settings?error=line_auth_failed`);
  }

  // Verify state
  const cookieState = cookies().get('line_oauth_state')?.value;
  if (state !== cookieState) {
    return NextResponse.redirect(`${appUrl}/admin/settings?error=invalid_state`);
  }

  const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
  const channelSecret = process.env.LINE_LOGIN_CHANNEL_SECRET;
  const callbackUrl = `${appUrl}/api/auth/line/callback`;

  if (!channelId || !channelSecret) {
    return NextResponse.redirect(`${appUrl}/admin/settings?error=missing_credentials`);
  }

  try {
    // 1. Get Access Token & ID Token
    const tokenResponse = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: callbackUrl,
        client_id: channelId,
        client_secret: channelSecret,
      })
    });

    const tokenData = await tokenResponse.json();
    if (!tokenData.id_token) {
      throw new Error('No id_token in response');
    }

    // 2. Verify ID Token
    const verifyResponse = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        id_token: tokenData.id_token,
        client_id: channelId,
      })
    });

    const verifyData = await verifyResponse.json();
    if (verifyData.error || !verifyData.sub) {
      throw new Error(verifyData.error_description || 'Invalid id_token');
    }

    const lineUserId = verifyData.sub;

    // 3. Update Supabase
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.redirect(`${appUrl}/admin/settings?error=not_authenticated`);
    }

    const { error: updateError } = await supabase
      .from('stylists')
      .update({ line_user_id: lineUserId })
      .eq('id', user.id);

    if (updateError) {
      throw updateError;
    }

    // Success redirect
    return NextResponse.redirect(`${appUrl}/admin/settings?success=line_linked`);

  } catch (err: any) {
    console.error('LINE Auth Error:', err);
    return NextResponse.redirect(`${appUrl}/admin/settings?error=link_failed`);
  }
}
