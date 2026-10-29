// キュー
import { test, expect, expectToast, answerDialog, chooseMenu, fail, song } from './fixtures.js';

const rows = (page) => page.locator('#queue .row');

test('曲を表示し、現在の曲を強調する', async ({ page }) => {
  await page.goto('/');
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).nth(0)).toContainText('Song 0');
  await expect(rows(page).nth(0)).toContainText('Artist 0 • Album 0');
  await expect(rows(page).nth(0)).toContainText('3:20');
  await expect(rows(page).nth(0)).toHaveClass(/current/);
  await expect(page.locator('#queueInfo')).toHaveText('My Queue · 3 曲');
  await expect(page.locator('#btnQueueMore')).toBeHidden();
});

test('名前・時間・画像の無い曲、空のキュー', async ({ page, player }) => {
  player.queue = { name: undefined, songs: [{ id: '0', image: '/img.png' }] };
  await page.goto('/');
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator('#queueInfo')).toHaveText('1 曲');
  player.queue.songs = [];
  player.setStatus({ pid: '2' });
  await expect(page.locator('#queue')).toHaveText('キューは空です');
  await expect(page.locator('#queueInfo')).toHaveText('');
});

test('クリックで再生、× で削除、メニュー', async ({ page, player }) => {
  await page.goto('/');
  await rows(page).nth(1).click();
  await rows(page).nth(2).locator('[title="キューから削除"]').click();
  await expect.poll(() => player.calls).toEqual(expect.arrayContaining(['/Play?id=1', '/Delete?id=2']));
  await rows(page).nth(1).locator('[title="メニュー"]').click();
  await expect(page.locator('#menuTitle')).toHaveText('Song 1');
  await expect(page.locator('#menuItems button').first()).toHaveText('お気に入りに追加');
  // キューの曲はお気に入りの状態が分からないので、追加と削除の両方を出す
  await expect(page.locator('#menuItems button').nth(1)).toHaveText('お気に入りから削除');
});

test('クリア（確認あり）', async ({ page, player }) => {
  await page.goto('/');
  answerDialog(page, null);
  await page.click('#btnClear');
  answerDialog(page);
  await page.click('#btnClear');
  await expect.poll(() => player.sent('/Clear')).toHaveLength(1);
});

test('200 曲を超えたら「さらに読み込む」で続きを取得し、再読み込みでも表示数を保つ', async ({ page, player }) => {
  player.queue.songs = Array.from({ length: 450 }, (_, i) => song(i));
  await page.goto('/');
  await expect(rows(page)).toHaveCount(200);
  await expect(page.locator('#queueInfo')).toHaveText('My Queue · 450 曲（200 曲を表示中）');
  await page.click('#btnQueueMore');
  await expect(rows(page)).toHaveCount(400);
  expect(player.sent('/Playlist')).toContain('/Playlist?start=200&end=399');
  player.setStatus({ pid: '2' });
  await expect.poll(() => player.sent('/Playlist')).toContain('/Playlist?start=0&end=399');
  await expect(rows(page)).toHaveCount(400);
  player.on('/Playlist', () => fail('gone'));
  await page.click('#btnQueueMore');
  await expectToast(page, 'エラー: gone');
  await expect(page.locator('#btnQueueMore')).toBeEnabled();
});

test('取得に失敗したらエラーを表示する', async ({ page, player }) => {
  player.on('/Playlist', () => fail('down'));
  await page.goto('/');
  await expect(page.locator('#queue')).toHaveText('キューを取得できません: down');
});

test('読み込み中に再読み込みを頼まれたら、終わった後にもう一度取得する', async ({ page, player }) => {
  let release;
  const gate = new Promise((r) => (release = r));
  let n = 0;
  player.on('/Playlist', async (u) => {
    if (++n === 2) await gate; // 2 回目（pid 変更による再読み込み）を止める
    return player.defaultResponse('/Playlist', u);
  });
  await page.goto('/');
  await expect(rows(page)).toHaveCount(3);
  player.setStatus({ pid: '2' });
  await expect.poll(() => n).toBe(2);
  player.queue.songs.push(song(3));
  player.setStatus({ pid: '3' }); // 読み込み中の依頼
  release();
  await expect(rows(page)).toHaveCount(4);
  expect(n).toBe(3);
});

test('ドラッグで並べ替える。ドラッグ直後のクリックでは再生しない', async ({ page, player }) => {
  await page.goto('/');
  await expect(rows(page)).toHaveCount(3);
  const handle = rows(page).nth(0).locator('.drag');
  const hb = await handle.boundingBox();
  const last = await rows(page).nth(2).boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2, last.y + last.height * 0.8, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => player.sent('/Move')).toEqual(['/Move?old=0&new=2']);
  // ドラッグ直後に行へ click が届いても再生しない
  await rows(page).nth(2).dispatchEvent('click');
  // ハンドル自体のクリックも再生しない
  await rows(page).nth(1).locator('.drag').click();
  expect(player.sent('/Play?id=')).toEqual([]);

  // 動かさずに離した時・右ボタンでは何もしない
  const h1 = await rows(page).nth(1).locator('.drag').boundingBox();
  await page.mouse.move(h1.x + 2, h1.y + 2);
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  await page.mouse.down();
  await page.mouse.up();
  expect(player.sent('/Move')).toHaveLength(1);
});

test('ドラッグ中に画面端へ寄せると自動でスクロールする', async ({ page, player }) => {
  player.queue.songs = Array.from({ length: 60 }, (_, i) => song(i));
  await page.setViewportSize({ width: 600, height: 500 });
  await page.goto('/');
  await expect(rows(page)).toHaveCount(60);
  const row = rows(page).nth(5);
  await row.scrollIntoViewIfNeeded();
  const hb = await row.locator('.drag').boundingBox();
  await page.mouse.move(hb.x + 2, hb.y + 2);
  await page.mouse.down();
  const before = await page.evaluate(() => window.scrollY);
  await page.mouse.move(hb.x + 2, 490, { steps: 3 });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
  const mid = await page.evaluate(() => window.scrollY);
  await page.mouse.move(hb.x + 2, 10, { steps: 3 });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(mid);
  await page.mouse.up();
});

test.describe('プレイリストとして保存', () => {
  test('新しい名前で保存する', async ({ page, player }) => {
    await page.goto('/');
    await expect(rows(page)).toHaveCount(3);
    answerDialog(page, 'New');
    await page.click('#btnSave');
    await expectToast(page, '「New」に保存しました');
    expect(player.sent('/Save')).toEqual(['/Save?name=New']);
  });

  test('同名は確認して上書き。取り消し・空の名前は何もしない', async ({ page, player }) => {
    await page.goto('/');
    await page.click('[data-tab="playlists"]');
    await expect(page.locator('#playlists .row')).toHaveCount(2);
    await page.click('[data-tab="queue"]');
    // 上書きの確認で取り消す
    answerDialog(page, 'Chill', null);
    await page.click('#btnSave');
    await expect.poll(() => player.sent('/Playlists').length).toBeGreaterThan(1);
    // 上書きする（プレイリスト一覧の表示中なので一覧を読み直す）
    answerDialog(page, 'Chill', '');
    await page.click('#btnSave');
    await expectToast(page, '「Chill」に保存しました');
    answerDialog(page, '  ');
    await page.click('#btnSave');
    answerDialog(page, null);
    await page.click('#btnSave');
    expect(player.sent('/Save')).toEqual(['/Save?name=Chill']);
  });

  test('保存に失敗したらエラー', async ({ page, player }) => {
    player.on('/Save', () => fail('disk full'));
    await page.goto('/');
    answerDialog(page, 'X');
    await page.click('#btnSave');
    await expectToast(page, 'エラー: disk full');
  });
});

test('キューの曲のメニューからアルバムへ移動', async ({ page, player }) => {
  await page.goto('/');
  await rows(page).nth(0).locator('[title="メニュー"]').click();
  await chooseMenu(page, 'アルバムへ移動');
  await expect(page.locator('#crumbs')).toHaveText('ソース › Library › Album 0');
  expect(player.sent('/api/browse')).toContain('/api/browse?key=LocalMusic%3AMG%2FLocalMusic-Album%3Falbum%3DAlbum%2B0%26artist%3DArtist%2B0');
});
