import { randomUUID } from 'node:crypto';
import { test as base, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

export const appURL = 'http://localhost:3000';
export const supabaseURL = 'http://127.0.0.1:54321';

// These tests create disposable users and data. Never allow a hosted target.
export function assertLocalEnvironment() {
  if (process.env.LINO_E2E_LOCAL !== '1'
      || process.env.NEXT_PUBLIC_BASE_URL !== appURL
      || process.env.NEXT_PUBLIC_SUPABASE_URL !== supabaseURL) {
    throw new Error('E2E requires the isolated local Supabase and localhost app');
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Local Supabase test keys are missing');
  }
}

type Account = { id: string; email: string; password: string };
type Fixtures = { admin: SupabaseClient; account: Account };

export async function createTestAccount(admin: SupabaseClient): Promise<Account> {
  assertLocalEnvironment();
  const email = `e2e-${randomUUID()}@example.test`;
  const password = randomUUID() + randomUUID();
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: '自動検証用スタイリスト' },
  });
  if (error || !data.user) throw new Error('Could not create disposable Auth user');
  const id = data.user.id;
  const stylist = await admin.from('stylists').upsert({ id, name: '自動検証用スタイリスト' });
  if (stylist.error) throw new Error(`Could not seed stylist: ${stylist.error.message}`);
  const billing = await admin.from('billing_accounts').upsert({ stylist_id: id, is_master: true });
  if (billing.error) throw new Error(`Could not seed billing: ${billing.error.message}`);
  return { id, email, password };
}

export const test = base.extend<Fixtures>({
  admin: async ({}, use) => {
    assertLocalEnvironment();
    const admin = createClient(supabaseURL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await use(admin);
  },
  account: async ({ admin }, use) => {
    await use(await createTestAccount(admin));
    // The runner's entire disposable database is destroyed after the suite.
    // No cleanup path is allowed to touch staging or production accounts.
  },
  page: async ({ page, context, account }, use) => {
    const cookies = new Map<string, string>();
    const auth = createServerClient(supabaseURL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false },
      cookies: {
        getAll: () => Array.from(cookies.entries()).map(([name, value]) => ({ name, value })),
        setAll: values => { for (const { name, value } of values) cookies.set(name, value); },
      },
    });
    const { error } = await auth.auth.signInWithPassword({ email: account.email, password: account.password });
    if (error) throw new Error('Could not sign in disposable Auth user');
    await context.addCookies(Array.from(cookies.entries()).map(([name, value]) => ({
      name, value, url: appURL, sameSite: 'Lax' as const,
    })));
    await use(page);
    // Do not write storageState, cookies, tokens, or network traces to artifacts.
  },
});
export { expect };
