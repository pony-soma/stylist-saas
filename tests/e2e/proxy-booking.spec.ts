import { test, expect, appURL } from './fixtures';

test('proxy reservation explains closed days, then saves on an open day', async ({ page, account, admin }, testInfo) => {
  const customerResponse = await page.request.post('/api/customers', {
    headers: { Origin: appURL }, data: { display_name: '代理予約確認用', phone_number: '', memo: '' },
  });
  expect(customerResponse.status()).toBe(201);
  const customer = await admin.from('stylist_customers').select('customer_id').eq('stylist_id', account.id).single();
  expect(customer.error).toBeNull();
  const menu = await admin.from('menus').insert({ stylist_id: account.id, name: '確認カット', duration: 60, price: 5000 }).select('id').single();
  expect(menu.error).toBeNull();
  const closed = await admin.from('availability_settings').insert({ stylist_id: account.id, specific_date: '2030-01-07', is_day_off: true });
  expect(closed.error).toBeNull();
  await page.goto('/admin');
  await page.goto('/admin/bookings/new?date=2030-01-07');
  await page.getByLabel('お客様', { exact: true }).selectOption(customer.data!.customer_id);
  await page.getByRole('checkbox', { name: /確認カット/ }).check();
  await page.getByRole('button', { name: '予約を確定', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('proxy-booking-actions.png') });
  const rejected = page.waitForResponse(r => r.url().endsWith('/api/bookings/save') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '予約を確定', exact: true }).click();
  expect((await rejected).status()).toBe(400);
  await expect(page.getByRole('alert').filter({ hasText: '定休日または営業時間外' })).toBeVisible();
  expect((await admin.from('bookings').select('id').eq('stylist_id', account.id)).data).toEqual([]);
  await expect(page.getByRole('checkbox', { name: /確認カット/ })).toBeChecked();
  await page.getByLabel('日付', { exact: true }).fill('2030-01-09');
  page.on('dialog', dialog => dialog.accept());
  const saved = page.waitForResponse(r => r.url().endsWith('/api/bookings/save') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '予約を確定', exact: true }).click();
  expect((await saved).status()).toBe(201);
  await expect(page).toHaveURL(`${appURL}/admin?date=2030-01-09`);
  await expect(page.getByText('1月9日のスケジュール', { exact: true })).toBeVisible();
  await expect(page.getByText('代理予約確認用', { exact: true })).toBeVisible();
  const booking = await admin.from('bookings').select('id,customer_id,start_time,end_time,total_price,status,source').eq('stylist_id', account.id).single();
  expect(booking.error).toBeNull();
  expect(booking.data).toMatchObject({ customer_id: customer.data!.customer_id, total_price: 5000, status: 'confirmed', source: 'proxy' });
  expect(Date.parse(booking.data!.start_time)).toBe(Date.parse('2030-01-09T10:00:00+09:00'));
  expect(Date.parse(booking.data!.end_time)).toBe(Date.parse('2030-01-09T11:00:00+09:00'));

  // Editing across a month boundary must fetch and show the new month's reservation.
  await page.goto(`/admin/bookings/${booking.data!.id}/edit`);
  await expect(page.locator('input[type="date"]')).toHaveValue('2030-01-09');
  await page.locator('input[type="date"]').fill('2030-02-06');
  const updated = page.waitForResponse(r => r.url().endsWith('/api/bookings/save') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '変更を保存', exact: true }).click();
  expect((await updated).status()).toBe(200);
  await expect(page).toHaveURL(`${appURL}/admin?date=2030-02-06`);
  await expect(page.getByText('2月6日のスケジュール', { exact: true })).toBeVisible();
  await expect(page.getByText('代理予約確認用', { exact: true })).toBeVisible();

  // Ordinary dashboard visits still start on today; malformed dates must not break it.
  const today = await page.evaluate(() => `${new Date().getMonth() + 1}月${new Date().getDate()}日のスケジュール`);
  for (const url of ['/admin', '/admin?date=2030-02-31', '/admin?date=invalid']) {
    await page.goto(url);
    await expect(page.getByText(today, { exact: true })).toBeVisible();
  }
});
