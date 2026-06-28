import { NextResponse } from 'next/server';
import * as line from '@line/bot-sdk';

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
  channelSecret: process.env.LINE_CHANNEL_SECRET || '',
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { lineUserId, customerName, startTime, menuNames, totalPrice, menuNote } = body;

    if (!lineUserId) {
      return NextResponse.json({ error: 'No LINE User ID provided' }, { status: 400 });
    }

    if (!config.channelAccessToken) {
      console.warn('LINE_CHANNEL_ACCESS_TOKEN is not set.');
      return NextResponse.json({ success: false, message: 'LINE SDK not configured' });
    }

    const client = new line.messagingApi.MessagingApiClient(config);

    const dateStr = new Date(startTime).toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    const messageText = `📅 新規の予約リクエストが入りました！\n\n` +
      `【お客様】${customerName} 様\n` +
      `【日時】${dateStr}〜\n` +
      `【メニュー】${menuNames}\n` +
      `【合計料金】¥${totalPrice.toLocaleString()}\n` +
      (menuNote ? `【備考】${menuNote}\n` : '') +
      `\nダッシュボードから承認を行ってください。`;

    await client.pushMessage({
      to: lineUserId,
      messages: [{ type: 'text', text: messageText }]
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error sending LINE notification:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
