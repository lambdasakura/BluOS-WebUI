// タブ・メニュー・ダイアログなど画面全体の振る舞い
import { test, expect, chooseMenu } from './fixtures.js';

test('前回のタブを開く。localStorage が使えなくても動く', async ({ page }) => {
  await page.goto('/');
  await page.click('[data-tab="alarms"]');
  await page.reload();
  await expect(page.locator('#tab-alarms')).toBeVisible();
  await expect(page.locator('[data-tab="alarms"]')).toHaveClass(/active/);

  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
  });
  await page.reload();
  await expect(page.locator('#tab-queue')).toBeVisible();
  await page.click('[data-tab="playlists"]');
  await expect(page.locator('#tab-playlists')).toBeVisible();
});

test('下までスクロールしてからタブを切り替えると、タブの先頭に戻る', async ({ page, player }) => {
  player.queue.songs = Array.from({ length: 80 }, (_, i) => ({ id: String(i), title: `S${i}` }));
  await page.setViewportSize({ width: 600, height: 500 });
  await page.goto('/');
  await expect(page.locator('#queue .row')).toHaveCount(80);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const bottom = await page.evaluate(() => window.scrollY);
  await page.click('[data-tab="alarms"]');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(bottom);
  // ヘッダーの高さを CSS 変数に渡す
  const h = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--topbar-h'));
  expect(h).toMatch(/^\d+px$/);
});

test('Esc でメニュー・技術情報を閉じ、背景のクリックでも閉じる', async ({ page }) => {
  await page.goto('/');
  await page.click('#btnSleep');
  await expect(page.locator('#menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toBeHidden();

  await page.click('#btnNpMenu');
  await chooseMenu(page, '技術情報');
  await expect(page.locator('#info')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#info')).toBeHidden();

  await page.click('#btnNpMenu');
  await chooseMenu(page, '技術情報');
  await page.locator('#info').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#info')).toBeHidden();
  // シートの中のクリックでは閉じない
  await page.click('#btnSleep');
  await page.click('#menuTitle');
  await expect(page.locator('#menu')).toBeVisible();
  await page.click('#menuCancel');
  await page.click('#btnNpMenu');
  await chooseMenu(page, '技術情報');
  await page.click('#infoTitle');
  await expect(page.locator('#info')).toBeVisible();
  // Esc 以外のキーは何もしない
  await page.keyboard.press('a');
  await expect(page.locator('#info')).toBeVisible();
});

test('トーストは時間が経つと消える', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await page.click('#btnSkip');
  await expect(page.locator('#toast')).toBeHidden(); // 成功メッセージのない操作
  await page.click('#btnNpMenu');
  await chooseMenu(page, 'お気に入りに追加');
  await expect(page.locator('#toast')).toBeVisible();
  await page.clock.runFor(3000);
  await expect(page.locator('#toast')).toBeHidden();
});
