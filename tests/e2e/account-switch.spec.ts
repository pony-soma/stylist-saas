import { test, expect } from './fixtures';

for (const pending of [false, true]) {
  test(`account switching works from ${pending ? 'unpaid billing' : 'settings'} on mobile`, async ({ page, account, admin }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    if (pending) {
      const changed = await admin.from('billing_accounts').update({
        stripe_status: null, trial_started_at: null, period_end: null,
      }).eq('stylist_id', account.id);
      expect(changed.error).toBeNull();
    }
    await page.goto('/');
    await page.getByRole('link', { name: 'ログイン', exact: true }).click();
    await expect(page).toHaveURL(pending ? /\/billing$/ : /\/admin(?:\?|$)/);
    if (!pending) {
      await expect(page.getByRole('region', { name: 'ログイン中のアカウント' })).toHaveCount(0);
      await expect(page.getByRole('status')).toHaveCount(0);
      await page.goto('/admin/settings');
    }
    await expect(page.getByText(`ログイン中：${account.email}`, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '別のGoogleアカウントに切り替える' }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await page.request.get('/api/billing/status')).status()).toBe(401);
    const accountAfter = await admin.from('billing_accounts').select('stylist_id').eq('stylist_id', account.id).single();
    expect(accountAfter.data?.stylist_id).toBe(account.id);
    // Inspect the OAuth request without contacting Google or using real credentials.
    let oauthURL = '';
    await page.route('**/auth/v1/authorize?**', async route => {
      oauthURL = route.request().url();
      await route.fulfill({ status: 200, contentType: 'text/plain', body: 'OAuth request intercepted' });
    });
    await page.getByRole('button', { name: 'Google アカウントでログイン', exact: true }).click();
    await expect.poll(() => oauthURL).not.toBe('');
    expect(new URL(oauthURL).searchParams.get('prompt')).toBe('select_account');
    expect(new URL(oauthURL).searchParams.get('provider')).toBe('google');
  });
}

test('logout from settings returns home and clears access', async ({ page }) => {
  await page.goto('/admin/settings');
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
  await expect(page).toHaveURL('http://localhost:3000/');
  expect((await page.request.get('/api/billing/status')).status()).toBe(401);
  await page.goto('/admin/settings');
  await expect(page).toHaveURL(/\/login/);
});
