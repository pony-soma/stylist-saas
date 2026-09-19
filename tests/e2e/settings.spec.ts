import { randomUUID } from 'node:crypto';
import { test, expect, appURL, createTestAccount } from './fixtures';

test('menu and weekly/specific settings persist through reload without duplicate days', async ({ page, account, admin }) => {
  const name = `検証メニュー-${randomUUID().slice(0, 8)}`;
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/admin/menus/new');
  await page.getByLabel('メニュー名', { exact: true }).fill(name);
  await page.getByLabel('所要時間 (分)', { exact: true }).selectOption('45');
  await page.getByLabel('料金 (円)', { exact: true }).fill('3300');
  await page.getByRole('button', { name: '保存する', exact: true }).click();
  await page.waitForURL('**/admin/menus');
  await page.reload();
  await expect(page.getByRole('link', { name: `${name}を編集` }).filter({ visible: true })).toBeVisible();
  const menu = await admin.from('menus').select('id,name,duration,price').eq('stylist_id', account.id).eq('name', name).single();
  expect(menu.error).toBeNull();
  expect(menu.data).toMatchObject({ name, duration: 45, price: 3300 });
  await page.getByRole('link', { name: `${name}を編集` }).filter({ visible: true }).click();
  await page.getByLabel('料金 (円)', { exact: true }).fill('4400');
  await page.getByRole('button', { name: '保存する', exact: true }).click();
  await page.waitForURL('**/admin/menus');
  expect((await admin.from('menus').select('price').eq('id', menu.data!.id).single()).data?.price).toBe(4400);

  await page.goto('/admin/schedule/settings');
  await page.getByLabel('月曜日の開始時刻', { exact: true }).fill('10:00');
  await page.getByLabel('月曜日の終了時刻', { exact: true }).fill('18:00');
  await page.getByLabel('日曜日を定休日にする', { exact: true }).check();
  for (let i = 0; i < 2; i++) {
    const saved = page.waitForResponse(r => r.url().endsWith('/api/settings') && r.request().method() === 'POST');
    await page.getByRole('button', { name: '設定を保存', exact: true }).click();
    expect((await saved).status()).toBe(200);
    await page.reload();
    await expect(page.getByLabel('月曜日の開始時刻', { exact: true })).toHaveValue('10:00');
    await expect(page.getByLabel('日曜日を定休日にする', { exact: true })).toBeChecked();
  }
  const week = await admin.from('availability_settings').select('day_of_week').eq('stylist_id', account.id).not('day_of_week', 'is', null);
  expect(week.error).toBeNull();
  expect(week.data).toHaveLength(7);
  expect(new Set(week.data!.map(r => r.day_of_week)).size).toBe(7);
  await page.getByLabel('特定日', { exact: true }).fill('2027-01-02');
  const added = page.waitForResponse(r => r.url().endsWith('/api/settings') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '追加する', exact: true }).click();
  expect((await added).status()).toBe(200);
  await page.reload();
  const remove = page.getByRole('button', { name: '2027-01-02の設定を削除', exact: true });
  await expect(remove).toBeVisible();
  const deleted = page.waitForResponse(r => r.url().endsWith('/api/settings') && r.request().method() === 'POST');
  await remove.click();
  expect((await deleted).status()).toBe(200);
  await expect(remove).toHaveCount(0);
});

test('settings reject anonymous, foreign-owner and expired writes while keeping data unchanged', async ({ page, account, admin, playwright }) => {
  const anonymous = await playwright.request.newContext({ baseURL: appURL, storageState: { cookies: [], origins: [] } });
  const payload = { action: 'menu.create', name: '拒否テスト', duration: 60, price: 1000 };
  try { expect((await anonymous.post('/api/settings', { headers: { Origin: appURL }, data: payload })).status()).toBe(401); }
  finally { await anonymous.dispose(); }
  const other = await createTestAccount(admin);
  const seeded = await admin.from('menus').insert({ stylist_id: other.id, name: '別担当', duration: 60, price: 5000 }).select('id').single();
  expect(seeded.error).toBeNull();
  const foreignId = seeded.data!.id;
  const post = (data: object) => page.request.post('/api/settings', { headers: { Origin: appURL }, data });
  expect((await post({ ...payload, action: 'menu.update', id: foreignId })).status()).toBe(404);
  expect((await post({ action: 'menu.delete', id: foreignId })).status()).toBe(404);
  expect((await post({ ...payload, stylist_id: other.id })).status()).toBe(400);
  expect((await admin.from('menus').select('name').eq('id', foreignId).single()).data?.name).toBe('別担当');
  const block = { action: 'blocked.create', title: '休憩', start_time: '2027-01-02T03:00:00Z', end_time: '2027-01-02T04:00:00Z' };
  expect((await post(block)).status()).toBe(200);
  const slot = await admin.from('blocked_time_slots').select('id').eq('stylist_id', account.id).single();
  expect(slot.error).toBeNull();
  expect((await post({ action: 'blocked.delete', id: slot.data!.id })).status()).toBe(200);
  const expire = await admin.from('billing_accounts').update({ is_master: false, stripe_status: 'trialing', period_end: new Date(Date.now() - 60_000).toISOString() }).eq('stylist_id', account.id);
  expect(expire.error).toBeNull();
  expect((await post(payload)).status()).toBe(403);
  expect((await post(block)).status()).toBe(403);
  expect((await post({ action: 'availability.save', settings: [{ day_of_week: 0, specific_date: null, is_day_off: true, start_time: null, end_time: null }] })).status()).toBe(403);
  expect((await admin.from('menus').select('id').eq('stylist_id', account.id)).data).toEqual([]);
});
