import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures';

test('customer → medical record/photo → reload → edit → permanent photo deletion', async ({ page, account, admin, playwright, baseURL }) => {
  const suffix = randomUUID().slice(0, 8);
  const name = `自動確認顧客-${suffix}`;
  const menu = `自動確認カット-${suffix}`;
  const originalNotes = `保存確認-${suffix}`;
  const editedNotes = `編集確認-${suffix}`;
  const alerts: string[] = [];
  page.on('dialog', async dialog => {
    if (dialog.type() === 'confirm' && dialog.message() === 'この写真を削除してもよろしいですか？') {
      await dialog.accept();
    } else {
      alerts.push(dialog.message());
      await dialog.dismiss();
    }
  });

  let customerId = '';
  let recordId = '';
  let photoId = '';
  let storagePath = '';

  await test.step('create customer through the real form and verify ownership in DB', async () => {
    await page.goto('/admin/customers');
    await expect(page.getByRole('heading', { name: '顧客一覧', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '＋ 新規追加', exact: true }).click();
    await page.getByPlaceholder('例：山田 花子').fill(name);
    await page.getByPlaceholder('090-1234-5678').fill('09000000000');
    await page.getByPlaceholder('注意事項や好みなど...').fill('CI専用の架空データ');
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/customers') && response.request().method() === 'POST');
    await page.getByRole('button', { name: '登録する', exact: true }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(201);
    // The application immediately reloads on success; Chromium may evict the
    // response body. Verify the durable result and re-rendered UI instead.
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    const customer = await admin.from('customers').select('id').eq('display_name', name).single();
    expect(customer.error).toBeNull();
    customerId = customer.data!.id;
    expect(customerId).toMatch(/^[0-9a-f-]{36}$/);
    const relationship = await admin.from('stylist_customers').select('stylist_id').eq('customer_id', customerId).single();
    expect(relationship.error).toBeNull();
    expect(relationship.data?.stylist_id).toBe(account.id);
    await page.getByRole('heading', { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/customers/${customerId}$`));
  });

  await test.step('save record and actual PNG through UI, then verify private storage', async () => {
    await page.getByRole('button', { name: '新しいカルテを記録する', exact: true }).click();
    const form = page.getByRole('heading', { name: 'カルテを追加', exact: true }).locator('..').locator('..');
    await form.locator('input[type="date"]').fill('2026-09-16');
    await form.getByPlaceholder('例: カット＋カラー').fill(menu);
    await form.locator('label').filter({ hasText: /^使用薬剤・カラーレシピ$/ }).locator('..').locator('textarea').fill('架空の薬剤レシピ');
    await form.locator('label').filter({ hasText: /^メモ・会話内容$/ }).locator('..').locator('textarea').fill(originalNotes);
    // Generate a valid synthetic image locally. No customer image or external fixture is used.
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 16; canvas.height = 16;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#4f46e5'; context.fillRect(0, 0, 16, 16);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await form.locator('input[type="file"]').setInputFiles({ name: 'synthetic-record.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    const uploadPromise = page.waitForResponse(response => response.url().endsWith('/api/record-photos') && response.request().method() === 'POST');
    await form.getByRole('button', { name: '保存する', exact: true }).click();
    const upload = await uploadPromise;
    expect(upload.status()).toBe(201);
    await expect(page.getByRole('heading', { name: menu, exact: true })).toBeVisible();
    const record = await admin.from('medical_records').select('id, stylist_id, notes').eq('customer_id', customerId).single();
    expect(record.error).toBeNull();
    expect(record.data).toMatchObject({ stylist_id: account.id, notes: originalNotes });
    recordId = record.data!.id;
    const photo = await admin.from('record_photos').select('id, record_id, storage_path').eq('record_id', recordId).single();
    expect(photo.error).toBeNull();
    expect(photo.data?.record_id).toBe(recordId);
    photoId = photo.data!.id;
    storagePath = photo.data!.storage_path;
    const bucket = await admin.storage.getBucket('record-photos');
    expect(bucket.error).toBeNull();
    expect(bucket.data?.public).toBe(false);
    const stored = await admin.storage.from('record-photos').download(storagePath);
    expect(stored.error).toBeNull();
    expect(stored.data!.size).toBeGreaterThan(0);
  });

  await test.step('reload proves persistence; only authenticated owner can read the photo', async () => {
    await page.reload();
    await expect(page.getByText(originalNotes, { exact: true })).toBeVisible();
    const image = page.getByRole('img', { name: '施術写真 1', exact: true });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    const ownerRead = await page.request.get(`/api/record-photos/${photoId}`);
    expect(ownerRead.status()).toBe(200);
    expect(ownerRead.headers()['cache-control']).toContain('no-store');
    const anonymous = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    try {
      expect((await anonymous.get(`/api/record-photos/${photoId}`)).status()).toBe(401);
      const publicURL = admin.storage.from('record-photos').getPublicUrl(storagePath).data.publicUrl;
      expect((await anonymous.get(publicURL)).ok()).toBe(false);
    } finally {
      await anonymous.dispose();
    }
  });

  await test.step('edit notes through UI and verify persisted update after reload', async () => {
    await page.getByRole('button', { name: '編集', exact: true }).click();
    const editor = page.getByRole('heading', { name: 'カルテを編集', exact: true }).locator('..').locator('..');
    await editor.locator('label').filter({ hasText: /^メモ$/ }).locator('..').locator('textarea').fill(editedNotes);
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/medical-records/save') && response.request().method() === 'POST');
    await editor.getByRole('button', { name: '更新する', exact: true }).click();
    expect((await responsePromise).ok()).toBe(true);
    await expect(page.getByText(editedNotes, { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText(editedNotes, { exact: true })).toBeVisible();
    await expect(page.getByText(originalNotes, { exact: true })).toHaveCount(0);
    const record = await admin.from('medical_records').select('notes, revision').eq('id', recordId).single();
    expect(record.error).toBeNull();
    expect(record.data?.notes).toBe(editedNotes);
    expect(record.data!.revision).toBe(1);
  });

  await test.step('delete photo and verify completed ledger, absent DB row, absent object', async () => {
    await page.getByRole('button', { name: '編集', exact: true }).click();
    const photoContainer = page.getByRole('img', { name: '保存済み写真 1', exact: true }).locator('..');
    await photoContainer.hover();
    const deletePromise = page.waitForResponse(response => response.url().endsWith(`/api/record-photos/${photoId}/delete`) && response.request().method() === 'DELETE');
    await photoContainer.getByRole('button').click();
    const deletion = await deletePromise;
    expect(deletion.status()).toBe(200);
    await expect(page.getByRole('img', { name: '保存済み写真 1', exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(editedNotes, { exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: '施術写真 1', exact: true })).toHaveCount(0);
    const row = await admin.from('record_photos').select('id').eq('id', photoId);
    expect(row.error).toBeNull(); expect(row.data).toEqual([]);
    const job = await admin.from('photo_deletion_jobs').select('stylist_id, completed_at').eq('photo_id', photoId).single();
    expect(job.error).toBeNull();
    expect(job.data?.stylist_id).toBe(account.id);
    expect(job.data?.completed_at).toBeTruthy();
    const split = storagePath.lastIndexOf('/');
    const objects = await admin.storage.from('record-photos').list(storagePath.slice(0, split));
    expect(objects.error).toBeNull();
    expect(objects.data?.some(object => object.name === storagePath.slice(split + 1))).toBe(false);
    expect((await page.request.get(`/api/record-photos/${photoId}`)).status()).toBe(404);
    expect(alerts, 'Unexpected UI dialogs indicate a partial or failed operation').toEqual([]);
  });
});
