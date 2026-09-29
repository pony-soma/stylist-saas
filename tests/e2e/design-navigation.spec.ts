import { test, expect } from './fixtures';
import { expectDateInputsContained } from './date-bounds';

test('settings share one design; calendar is retired and account controls stay in settings', async ({page},testInfo)=>{
  await page.goto('/admin');
  await expect(page.getByRole('link',{name:'カレンダー',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'ログアウト',exact:true})).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath('dashboard.png'),fullPage:true});
  await page.getByRole('link',{name:'設定',exact:true}).click();
  const rows=page.getByRole('region',{name:'サービスの設定'}).getByRole('link');
  await expect(rows).toHaveCount(4);
  for(const row of await rows.all()) await expect(row.locator('.setting-icon')).toBeVisible();
  await expect(page.getByRole('button',{name:'ログアウト',exact:true})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('settings.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole('link',{name:/契約・お支払い/}).first().click();
  await expect(page.getByRole('heading',{name:'契約・お支払い',exact:true})).toBeVisible();
  await page.goto('/admin/schedule');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/schedule/settings');
  await expect(page.getByLabel('月曜日の開始時刻',{exact:true})).toBeVisible();
  await expectDateInputsContained(page);
});

test('public landing and login remain readable on mobile',async({page,context},testInfo)=>{
 await context.clearCookies();
 await page.goto('/');
 await expect(page.getByRole('heading',{level:1})).toContainText('つなぐ場所');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('home.png'),fullPage:true});
 await page.getByRole('link',{name:'ログイン',exact:true}).click();
 await expect(page.getByRole('button',{name:'Google アカウントでログイン',exact:true})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('login.png'),fullPage:true});
});
