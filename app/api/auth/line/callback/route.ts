import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const result = (key: 'success' | 'error', value: string) =>
    NextResponse.redirect(`${appUrl}/admin/settings/line?${key}=${value}`);
  
  if (errorParam || !code || !state) {
    return result('error', 'line_auth_failed');
  }

  // Verify state
  const cookieState = cookies().get('line_oauth_state')?.value;
  if (state !== cookieState) {
    return result('error', 'invalid_state');
  }

  const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
  const channelSecret = process.env.LINE_LOGIN_CHANNEL_SECRET;
  const callbackUrl = `${appUrl}/api/auth/line/callback`;

  if (!channelId || !channelSecret) {
    return result('error', 'missing_credentials');
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
    if (!tokenResponse.ok) {
      // Never log the response body: it may contain credentials or tokens.
      const reason = tokenData.error === 'invalid_client' ? 'line_client_invalid' : 'line_token_failed';
      console.error('LINE Auth Error:', reason, tokenResponse.status);
      return result('error', reason);
    }
    if (!tokenData.id_token) {
      return result('error', 'line_id_token_missing');
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
    if (!verifyResponse.ok || verifyData.error || typeof verifyData.sub !== 'string' || !verifyData.sub) {
      return result('error', 'line_verification_failed');
    }

    const lineUserId = verifyData.sub;

    // 3. Update Supabase
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return result('error', 'not_authenticated');
    }

    const { data: updated, error: updateError } = await supabase
      .from('stylists')
      .update({ line_user_id: lineUserId })
      .eq('id', user.id)
      .select('id')
      .single();

    if (updateError || !updated) {
      return result('error', 'line_save_failed');
    }

    // Success redirect
    cookies().delete('line_oauth_state');
    return result('success', 'line_linked');

  } catch (err: any) {
    console.error('LINE Auth Error: link_failed');
    return result('error', 'link_failed');
  }
}
