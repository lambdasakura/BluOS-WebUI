// プレイリスト
import { test, expect, expectToast, answerDialog, chooseMenu, fail } from './fixtures.js';

const rows = (page) => page.locator('#playlists .row');

// 一覧を読み直す（一覧の表示中はタブを切り替え直す）
async function reloadList(page) {
  await page.click('[data-tab="queue"]');
  await page.click('[data-tab="playlists"]');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.click('[data-tab="playlists"]');
});

test('一覧を表示し、行の ▶ とメニューで操作する', async ({ page, player }) => {
  await expect(rows(page)).toHaveCount(2);
  await expect(page.locator('#plInfo')).toHaveText('2 件');
  await expect(rows(page).nth(0).locator('img')).toHaveAttribute('src', '/api/d/pl.png');
  await rows(page).nth(0).locator('[title="再生"]').click();
  await expectToast(page, '「Chill」を再生');
  await rows(page).nth(1).locator('[title="メニュー"]').click();
  await expect(page.locator('#menuItems button')).toHaveText(['再生', 'シャッフル再生', '次に追加', '最後に追加', 'プリセットに追加', '削除']);
  await chooseMenu(page, 'シャッフル再生');
  await rows(page).nth(1).locator('[title="メニュー"]').click();
  await chooseMenu(page, '次に追加');
  await rows(page).nth(1).locator('[title="メニュー"]').click();
  await chooseMenu(page, '最後に追加');
  await expectToast(page, '「Rock & Roll」を最後に追加');
  expect(player.sent('/Add')).toEqual([
    '/Add?playlist=Chill&playnow=1&clear=0&shuffle=0',
    '/Add?playlist=Rock%20%26%20Roll&shuffle=1&playnow=1',
    '/Add?playlist=Rock%20%26%20Roll&playnow=-1&where=next',
    '/Add?playlist=Rock%20%26%20Roll&playnow=-1&where=last',
  ]);
});

test('削除（確認あり）', async ({ page, player }) => {
  await rows(page).nth(1).locator('[title="メニュー"]').click();
  answerDialog(page, null);
  await chooseMenu(page, '削除');
  await rows(page).nth(1).locator('[title="メニュー"]').click();
  answerDialog(page);
  await chooseMenu(page, '削除');
  await expectToast(page, '「Rock & Roll」を削除しました');
  expect(player.sent('/Delete')).toEqual(['/Delete?name=Rock%20%26%20Roll']);
  player.on('/Delete', () => fail('locked'));
  await rows(page).nth(0).locator('[title="メニュー"]').click();
  answerDialog(page);
  await chooseMenu(page, '削除');
  await expectToast(page, 'エラー: locked');
});

test('詳細で曲を表示し、操作ボタンと戻るが使える', async ({ page, player }) => {
  await rows(page).nth(0).click();
  await expect(page.locator('#plInfo')).toHaveText('Chill · 3 曲 · 6:40');
  await expect(rows(page)).toHaveCount(3);
  // 画像は songid か fn から組み立てる（どちらも無ければ代わりの表示）
  await expect(rows(page).nth(0).locator('img')).toHaveAttribute('src', '/api/d/Artwork?service=LocalMusic&songid=sid10');
  await expect(rows(page).nth(1).locator('.thumb.ph')).toHaveCount(1);
  await expect(rows(page).nth(2).locator('img')).toHaveAttribute('src', '/api/d/Artwork?service=LocalMusic&fn=%2Fmusic%2F12.flac');
  await expect(page.locator('#plActions button')).toHaveText(['再生', 'シャッフル再生', '次に追加', '最後に追加', 'プリセットに追加', '削除']);
  await page.locator('#plActions button', { hasText: 'プリセットに追加' }).click();
  await expectToast(page, '「Chill」をプリセットに追加しました');
  await page.click('#btnPlBack');
  await expect(rows(page)).toHaveCount(2);
  await expect(page.locator('#btnPlBack')).toBeHidden();
  // タブを切り替えて戻っても詳細を開いたままにする
  await rows(page).nth(1).click();
  await expect(page.locator('#playlists')).toHaveText('曲がありません');
  await expect(page.locator('#plInfo')).toHaveText('Rock & Roll · 0 曲');
  await page.click('[data-tab="queue"]');
  await page.click('[data-tab="playlists"]');
  await expect(page.locator('#plInfo')).toHaveText('Rock & Roll · 0 曲');
  expect(player.sent('/api/playlist-songs')).toEqual(['/api/playlist-songs?playlist=Chill', '/api/playlist-songs?playlist=Rock%20%26%20Roll']);
});

test('曲の取得に失敗したらエラー。移動した後のエラーは表示しない', async ({ page, player }) => {
  player.on('/api/playlist-songs', () => fail('timeout'));
  await rows(page).nth(0).click();
  await expect(page.locator('#playlists')).toHaveText('取得できません: timeout');

  let release;
  player.on('/api/playlist-songs', async () => { await new Promise((r) => (release = r)); return fail('late'); });
  await page.click('#btnPlBack');
  await rows(page).nth(0).click();
  await expect.poll(() => typeof release).toBe('function');
  await page.click('#btnPlBack');
  await expect(rows(page)).toHaveCount(2);
  release();
  await page.waitForTimeout(200);
  await expect(rows(page)).toHaveCount(2);
});

test('曲の読み込み中に戻ったら結果を捨てる', async ({ page, player }) => {
  let release;
  player.on('/api/playlist-songs', async (u) => {
    await new Promise((r) => (release = r));
    return player.defaultResponse('/api/playlist-songs', u);
  });
  await rows(page).nth(0).click();
  await expect.poll(() => typeof release).toBe('function');
  await page.click('#btnPlBack');
  await expect(rows(page)).toHaveCount(2);
  release();
  await page.waitForTimeout(200);
  await expect(page.locator('#plInfo')).toHaveText('2 件');
});

test('一覧の読み込み中に詳細を開いたら一覧で上書きしない', async ({ page, player }) => {
  await expect(rows(page)).toHaveCount(2);
  let release;
  player.on('/Playlists', async (u) => {
    await new Promise((r) => (release = r));
    return player.defaultResponse('/Playlists', u);
  });
  await reloadList(page); // 一覧を読み直す（応答を止める）
  await expect.poll(() => typeof release).toBe('function');
  await rows(page).nth(0).click(); // 古い一覧の行から詳細を開く
  await expect(page.locator('#plInfo')).toContainText('Chill ·');
  release();
  await page.waitForTimeout(200);
  await expect(page.locator('#plInfo')).toContainText('Chill ·');
});

test('一覧が空・取得失敗', async ({ page, player }) => {
  player.playlists = [];
  await reloadList(page);
  await expect(page.locator('#playlists')).toHaveText('プレイリストはありません。キュー画面から保存できます');
  player.on('/Playlists', () => fail('down'));
  await reloadList(page);
  await expect(page.locator('#playlists')).toHaveText('取得できません: down');
});

test('プレイリストの応答が単一の名前でも扱える', async ({ page, player }) => {
  player.on('/Playlists', () => ({ playlists: { name: 'Solo' } }));
  await reloadList(page);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).locator('.row-title')).toHaveText('Solo');
  await expect(rows(page).locator('.thumb.ph')).toHaveCount(1);
});
