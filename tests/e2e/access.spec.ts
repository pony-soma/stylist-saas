import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { test, expect, appURL, supabaseURL, createTestAccount } from './fixtures';

test('anonymous and expired accounts cannot register customers', async ({ page, account, admin, playwright }) => {
  const name = `拒否確認-${randomUUID().slice(0, 8)}`;
  const payload = { display_name: name, gender: 'unspecified' };
  const anonymous = await playwright.request.newContext({ baseURL: appURL, storageState: { cookies: [], origins: [] } });
  try {
    const response = await anonymous.post('/api/customers', { headers: { Origin: appURL }, data: payload });
    expect(response.status()).toBe(401);
  } finally {
    await anonymous.dispose();
  }

  // The disposable account remains genuinely authenticated but loses paid/master access.
  const expired = await admin.from('billing_accounts').update({
    is_master: false, stripe_status: 'trialing',
    period_end: new Date(Date.now() - 60_000).toISOString(),
  }).eq('stylist_id', account.id).select('stylist_id');
  expect(expired.error).toBeNull();
  expect(expired.data).toEqual([{ stylist_id: account.id }]);
  const denied = await page.request.post('/api/customers', { headers: { Origin: appURL }, data: payload });
  expect(denied.status()).toBe(403);
  const rows = await admin.from('customers').select('id').eq('display_name', name);
  expect(rows.error).toBeNull();
  expect(rows.data).toEqual([]);
  const relationships = await admin.from('stylist_customers').select('customer_id').eq('stylist_id', account.id);
  expect(relationships.error).toBeNull();
  expect(relationships.data).toEqual([]);
});

test('master access does not grant another stylist’s medical record permissions', async ({ page, account, admin }) => {
  const master = await admin.from('billing_accounts').update({ is_master: true }).eq('stylist_id', account.id).select('is_master');
  expect(master.error).toBeNull();
  expect(master.data).toEqual([{ is_master: true }]);
  const owner = await createTestAccount(admin);
  const created = await admin.rpc('create_manual_customer', {
    p_stylist_id: owner.id, p_display_name: `別担当顧客-${randomUUID().slice(0, 8)}`,
    p_phone_number: null, p_birth_date: null, p_gender: 'unspecified', p_memo: null,
  });
  expect(created.error).toBeNull();
  const customerId = created.data as string;
  const recordId = randomUUID();
  const recordFields = { visit_date: '2026-09-16', treatment_menu: '別担当の架空カット', chemicals_used: '', notes: '変更されてはいけない記録' };
  const saved = await admin.rpc('save_medical_record', {
    p_stylist_id: owner.id, p_action: 'create', p_id: recordId, p_customer_id: customerId,
    p_visit_date: recordFields.visit_date, p_treatment_menu: recordFields.treatment_menu,
    p_chemicals_used: recordFields.chemicals_used, p_notes: recordFields.notes, p_expected_revision: null,
  });
  expect(saved.error).toBeNull();
  expect(saved.data).toBe(recordId);

  // Use the public client and real Auth token, not the service client, to exercise RLS.
  const caller = createClient(supabaseURL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await caller.auth.signInWithPassword({ email: account.email, password: account.password });
  expect(signedIn.error).toBeNull();
  const read = await caller.from('medical_records').select('id, notes').eq('id', recordId);
  expect(read.error).toBeNull();
  expect(read.data).toEqual([]);

  const denied = await page.request.post('/api/medical-records/save', {
    headers: { Origin: appURL },
    data: { action: 'update', id: recordId, expectedRevision: 0, ...recordFields, notes: '他担当からの不正な更新' },
  });
  expect(denied.status()).toBe(404);
  const unchanged = await admin.from('medical_records').select('stylist_id, notes, revision').eq('id', recordId).single();
  expect(unchanged.error).toBeNull();
  expect(unchanged.data).toEqual({ stylist_id: owner.id, notes: recordFields.notes, revision: 0 });
});
