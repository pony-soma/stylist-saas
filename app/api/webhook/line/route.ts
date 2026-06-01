import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

// Supabase Service Role Client (RLSをバイパスしてシステム権限で更新するため)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET!;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN!;

export async function POST(req: Request) {
  try {
    const text = await req.text();
    const signature = req.headers.get('x-line-signature') || '';

    // 1. LINE署名の検証
    const hash = crypto
      .createHmac('SHA256', LINE_CHANNEL_SECRET)
      .update(text)
      .digest('base64');
    
    if (hash !== signature) {
      console.error('Signature validation failed');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = JSON.parse(text);
    const events = body.events;

    for (const event of events) {
      // 2. Postbackイベントの処理 (予約キャンセル等のボタンアクション)
      if (event.type === 'postback') {
        const data = new URLSearchParams(event.postback.data);
        const action = data.get('action');
        const bookingId = data.get('bookingId');

        if (action === 'cancel' && bookingId) {
          // Supabaseの予約ステータスを'cancelled'に更新
          const { error } = await supabase
            .from('bookings')
            .update({ status: 'cancelled', updated_at: new Date().toISOString() })
            .eq('id', bookingId)
            .eq('status', 'confirmed'); // 確定済みのみキャンセル可能とするなどのガード

          if (error) {
            console.error('Failed to update booking:', error);
            continue;
          }

          // 3. キャンセル完了メッセージの自動返信
          await fetch('https://api.line.me/v2/bot/message/reply', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
            },
            body: JSON.stringify({
              replyToken: event.replyToken,
              messages: [
                {
                  type: 'text',
                  text: 'ご予約のキャンセルを受け付けました。またのご来店をお待ちしております。',
                },
              ],
            }),
          });
        }
      }
    }

    return NextResponse.json({ status: 'success' }, { status: 200 });
  } catch (error) {
    console.error('Error handling webhook:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
