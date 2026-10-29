// アプリとしてインストールできること（manifest とアイコン）
import { test, expect } from './fixtures.js';

test('manifest とアイコンを読み込める', async ({ page }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = await (await page.request.get(href)).json();
  expect(manifest).toMatchObject({ name: expect.any(String), start_url: '/', scope: '/', display: 'standalone' });
  // インストールに必要な 192px・512px の PNG と、マスク用のアイコン
  expect(manifest.icons.map((i) => `${i.sizes} ${i.type} ${i.purpose ?? 'any'}`)).toEqual(expect.arrayContaining([
    '192x192 image/png any', '512x512 image/png any', '512x512 image/png maskable',
  ]));
  const icons = [...manifest.icons.map((i) => i.src), await page.locator('link[rel="apple-touch-icon"]').getAttribute('href')];
  for (const src of icons) {
    const r = await page.request.get(src);
    expect(r.ok(), src).toBe(true);
    expect(r.headers()['content-type'], src).toMatch(/^image\//);
  }
});
