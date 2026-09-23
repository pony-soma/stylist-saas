import { randomUUID } from 'node:crypto';
import { test, expect, appURL } from './fixtures';

test('copied booking URL → LINE identity → menu/date → durable pending reservation; repeat safely', async ({ page, context, account, admin }) => {
  const lineHex = randomUUID().replaceAll('-', '');
  expect((await admin.from('stylists').update({line_user_id:'U'+randomUUID().replaceAll('-','')}).eq('id',account.id)).error).toBeNull();
  await context.addInitScript(token => sessionStorage.setItem('lino-e2e-line-token', token), 'e2e-line-' + lineHex);
  const menu = await admin.from('menus').insert({ stylist_id: account.id, name: 'LINE予約カット', duration: 60, price: 4200 }).select('id').single();
  expect(menu.error).toBeNull();
  await page.goto('/admin');
  // Clipboard is intercepted in this isolated browser, not sent to LINE.
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => { document.body.dataset.copiedBooking = text; } }, configurable: true }); });
  page.on('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '予約URLをコピー', exact: true }).click();
  const copied = await page.locator('body').getAttribute('data-copied-booking');
  expect(new URL(copied!).searchParams.get('stylist')).toBe(account.id);
  // Arrive with only LINE identity: no Supabase/Google cookies.
  await context.clearCookies();
  await page.goto('/liff?liff.state=' + encodeURIComponent('/?stylist=' + account.id));
  await expect(page.getByRole('heading', { name: 'ご予約', exact: true })).toBeVisible();
  await expect(page.getByText('予約テストのお客様 様', { exact: true })).toBeVisible();
  expect((await admin.from('customers').select('id').eq('line_user_id', 'U'+lineHex)).data).toEqual([]);
  await page.getByRole('checkbox', { name: /LINE予約カット/ }).check();
  await page.getByRole('button', { name: '翌月', exact: true }).click();
  await page.getByRole('button', { name: '1', exact: true }).click();
  await page.getByRole('button', { name: /10:00/ }).click();
  const saved = page.waitForResponse(r => r.url().endsWith('/api/liff/booking') && r.request().postDataJSON()?.action === 'save');
  await page.getByRole('button', { name: /予約.*(確定|リクエスト|送信)/ }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  expect((await response.json()).notification).toBe('accepted');
  await expect(page.getByRole('heading', { name: '予約リクエストを受け付けました', exact: true })).toBeVisible();
  const customer = await admin.from('customers').select('id').eq('line_user_id', 'U'+lineHex).single();
  expect(customer.error).toBeNull();
  const bookings = await admin.from('bookings').select('id,customer_id,status,source,total_price,start_time,end_time').eq('stylist_id', account.id);
  expect(bookings.error).toBeNull();
  expect(bookings.data).toHaveLength(1);
  expect(bookings.data![0]).toMatchObject({ customer_id: customer.data!.id, status: 'pending', source: 'liff', total_price: 4200 });
  expect(Date.parse(bookings.data![0].end_time)-Date.parse(bookings.data![0].start_time)).toBe(3600000);
  const replay = await page.request.post('/api/liff/booking', { headers: { Origin: appURL, Authorization: 'Bearer e2e-line-'+lineHex }, data: response.request().postDataJSON() });
  expect(replay.status()).toBe(201);
  expect((await replay.json()).notification).toBe('accepted');
  expect((await replay.json()).id).toBe(bookings.data![0].id);
  expect((await admin.from('bookings').select('id').eq('stylist_id', account.id)).data).toHaveLength(1);
  await page.goto('/liff?stylist='+account.id);
  await expect(page.getByRole('heading', { name: 'ご予約', exact: true })).toBeVisible();
  expect((await admin.from('customers').select('id').eq('line_user_id', 'U'+lineHex)).data).toHaveLength(1);
});

test('invalid booking link and unauthenticated LINE requests cannot select another stylist', async ({ page, context, account }) => {
  await context.clearCookies();
  await page.goto('/liff');
  await expect(page.getByText('予約先が指定されていません。担当者から届いた予約URLを開いてください。')).toBeVisible();
  const result = await page.request.post('/api/liff/booking', { headers: { Origin: appURL }, data: { action: 'load', stylistId: account.id } });
  expect(result.status()).toBe(401);
});

test('provider-rejected LINE token shows a safe error without loading customer data', async ({ page, context, account, admin }) => {
  await context.clearCookies();
  await context.addInitScript(() => sessionStorage.setItem('lino-e2e-line-token', 'rejected-token'));
  const before = await admin.from('bookings').select('id', { count: 'exact', head: true }).eq('stylist_id', account.id);
  expect(before.error).toBeNull();
  const request = page.waitForResponse(r => r.url().endsWith('/api/liff/booking'));
  await page.goto('/liff?stylist=' + account.id);
  const response = await request;
  expect(response.status()).toBe(401);
  await expect(page.getByText('LINEのログインを確認できません。予約URLから開き直してください。')).toBeVisible();
  expect(await response.text()).not.toContain('rejected-token');
  const after = await admin.from('bookings').select('id', { count: 'exact', head: true }).eq('stylist_id', account.id);
  expect(after.error).toBeNull();
  expect(after.count).toBe(before.count);
});

test('notification unavailable still completes the booking and explains saved state', async ({page, context, account, admin}) => {
  const lineHex = randomUUID().replaceAll('-', '');
  await context.clearCookies();
  await context.addInitScript(token => sessionStorage.setItem('lino-e2e-line-token', token), 'e2e-line-' + lineHex);
  expect((await admin.from('stylists').update({line_user_id:null}).eq('id',account.id)).error).toBeNull();
  expect((await admin.from('menus').insert({stylist_id:account.id,name:'通知失敗確認',duration:30,price:1000})).error).toBeNull();
  await page.goto('/liff?stylist='+account.id);
  await page.getByRole('checkbox',{name:/通知失敗確認/}).check();
  await page.getByRole('button',{name:'翌月',exact:true}).click();
  await page.getByRole('button',{name:'1',exact:true}).click();
  await page.getByRole('button',{name:/10:00/}).click();
  await page.getByRole('button',{name:/予約.*(確定|リクエスト|送信)/}).click();
  await expect(page.getByRole('heading',{name:'予約リクエストを受け付けました',exact:true})).toBeVisible();
  await expect(page.getByRole('status')).toContainText('予約は保存されていますが');
  const saved=await admin.from('bookings').select('status').eq('stylist_id',account.id);
  expect(saved.error).toBeNull();expect(saved.data).toEqual([{status:'pending'}]);
});
