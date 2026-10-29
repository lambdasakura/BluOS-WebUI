// 応答に値が欠けている・想定外の形の時の扱い
import { test, expect, expectToast, answerDialog, chooseMenu, fail, raw } from './fixtures.js';

test.describe('エラー応答の表示', () => {
  for (const [name, response, message] of [
    ['JSON でない HTTP エラー', raw(500, 'oops'), 'エラー: HTTP 500'],
    ['message を持つエラー', fail({ message: 'obj msg' }, 200), 'エラー: obj msg'],
    ['message の無いエラー', fail({ code: 7 }, 200), 'エラー: {"code":7}'],
  ]) {
    test(name, async ({ page, player }) => {
      player.on('/Skip', () => response);
      await page.goto('/');
      await page.click('#btnSkip');
      await expectToast(page, message);
    });
  }
});

test('状態に項目が欠けている', async ({ page, player }) => {
  player.status = { etag: '1', state: 'pause', pid: '1', image: 'Artwork?fn=x' };
  await page.goto('/');
  await expect(page.locator('#title')).toHaveText('—');
  await expect(page.locator('#art')).toHaveAttribute('src', '/api/d/Artwork?fn=x');
  await expect(page.locator('#service')).toHaveText('');
  await expect(page.locator('#quality')).toHaveText('');
  await expect(page.locator('#elapsed')).toHaveText('0:00');
  await expect(page.locator('#btnRepeat')).not.toHaveClass(/(^|\s)on(\s|$)/);
  await page.click('#btnRepeat');
  await expect.poll(() => player.calls).toContain('/Repeat?state=0');
  await page.keyboard.press('Escape'); // 何も開いていない時は何もしない
});

test('ラジオの「前へ」も actions の URL で操作する', async ({ page, player }) => {
  Object.assign(player.status, {
    streamUrl: 'X:1', service: 'X', fn: undefined,
    actions: { action: [{ name: 'back', url: '/Action?back=1' }] },
  });
  await page.goto('/');
  await page.click('#btnBack');
  await expect.poll(() => player.calls).toContain('/Action?back=1');
  await expect(page.locator('#toast')).toBeHidden(); // 通知文が無ければ何も出さない
});

test('スリープタイマーの応答に値が無ければオフ', async ({ page, player }) => {
  player.status.sleep = '15';
  player.on('/Sleep', () => ({}));
  await page.goto('/');
  await page.click('#btnSleep');
  await chooseMenu(page, 'オフ');
  await expectToast(page, 'スリープタイマーを解除しました');
});

test('Wake Lock API が無いブラウザでも全画面を開ける', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'wakeLock', { value: undefined }));
  await page.goto('/');
  await page.click('#btnFull');
  await expect(page.locator('body')).toHaveClass(/np-full/);
});

test('キュー: 総数の無い応答・時間の読めない曲・情報の少ない曲', async ({ page, player }) => {
  player.on('/Playlist', () => ({ playlist: { song: [
    { id: '0', title: 'T', time: 'abc' },
    { id: '1', service: 'LocalMusic' },
    { id: '2', service: 'LocalMusic', fn: '/x.flac' },
  ] } }));
  await page.goto('/');
  await expect(page.locator('#queueInfo')).toHaveText('3 曲');
  await expect(page.locator('#queue .row').nth(0).locator('.row-end')).toHaveText('0:00');
  // タイトル・アーティストの無いライブラリの曲（fn も無い）は曲情報だけ
  await page.locator('#queue .row').nth(1).locator('[title="メニュー"]').click();
  await expect(page.locator('#menuTitle')).toHaveText('');
  await expect(page.locator('#menuItems button')).toHaveText(['曲情報（last.fm）']);
  await page.click('#menuCancel');
  // タイトルの無い曲の技術情報
  await page.locator('#queue .row').nth(2).locator('[title="メニュー"]').click();
  await chooseMenu(page, '技術情報');
  await expect(page.locator('#infoTitle')).toHaveText('');
});

test('キューの読み込み前に保存を押すと名前の初期値は空', async ({ page, player }) => {
  let release;
  player.on('/Playlist', async (u) => { await new Promise((r) => (release = r)); return player.defaultResponse('/Playlist', u); });
  let promptDefault;
  page.dialogAnswers.push(null);
  page.on('dialog', (d) => (promptDefault = d.defaultValue()));
  await page.goto('/');
  await expect.poll(() => typeof release).toBe('function');
  await page.click('#btnSave');
  await expect.poll(() => promptDefault).toBe('');
  release();
});

test('プレイリストの詳細を開いたまま保存しても一覧で上書きしない', async ({ page, player }) => {
  await page.goto('/');
  await page.click('[data-tab="playlists"]');
  await page.locator('#playlists .row').nth(0).click();
  await expect(page.locator('#plInfo')).toContainText('Chill ·');
  await page.click('[data-tab="queue"]');
  const n = player.sent('/Playlists').length;
  answerDialog(page, 'New');
  await page.click('#btnSave');
  await expectToast(page, '「New」に保存しました');
  expect(player.sent('/Playlists')).toHaveLength(n + 1); // 同名確認の 1 回だけ
  await page.click('[data-tab="playlists"]');
  await expect(page.locator('#plInfo')).toContainText('Chill ·');
});

test('プレイリスト: 名前の無い項目・service や title の無い曲', async ({ page, player }) => {
  player.playlists = [{ image: '/x.png' }, 'X'];
  player.playlistSongs.X = [{ songid: 'a' }, { fn: '/b.flac' }];
  await page.goto('/');
  await page.click('[data-tab="playlists"]');
  await expect(page.locator('#playlists .row-title')).toHaveText(['', 'X']);
  await page.locator('#playlists .row').nth(1).click();
  await expect(page.locator('#playlists .row img')).toHaveCount(2);
  await expect(page.locator('#playlists .row img').nth(0)).toHaveAttribute('src', '/api/d/Artwork?service=&songid=a');
  await expect(page.locator('#playlists .row img').nth(1)).toHaveAttribute('src', '/api/d/Artwork?service=LocalMusic&fn=%2Fb.flac');
  await expect(page.locator('#playlists .row-title')).toHaveText(['', '']);
});

test('入力の取得に失敗してもプリセットは表示する', async ({ page, player }) => {
  player.on('/RadioBrowse', () => fail('no capture'));
  await page.goto('/');
  await page.click('[data-tab="presets"]');
  await expect(page.locator('#presets .tile')).toHaveCount(3);
  await expect(page.locator('#inputs')).toHaveText('取得できません: no capture');
});

test('url の無いプリセットの名前変更', async ({ page, player }) => {
  player.presets = [{ id: '1', name: 'NoUrl' }];
  await page.goto('/');
  await page.click('[data-tab="presets"]');
  await page.click('#btnPresetEdit');
  answerDialog(page, 'Renamed');
  await page.locator('#presets .tile').click();
  await expect.poll(() => player.sent('/SetPreset')).toEqual(['/SetPreset?id=1&name=Renamed']);
});

test('アラーム: source の無い音源を保つ・画像の無いプリセット', async ({ page, player }) => {
  player.alarms = [{ id: '1', hour: '7', minute: '0', days: '0000000', duration: '60', volume: '10', url: 'TuneIn:x' }];
  player.presets[1].image = undefined;
  await page.goto('/');
  await page.click('[data-tab="alarms"]');
  await page.locator('#alarms .row-main').click();
  await expect(page.locator('#alarmSource option').first()).toHaveText('現在の設定（TuneIn:x）');
  await page.click('#alarmForm button[type="submit"]');
  await page.locator('#alarms .row-main').click();
  await page.selectOption('#alarmSource', '2');
  await page.click('#alarmForm button[type="submit"]');
  await expect.poll(() => player.sent('/Alarms?hour')).toHaveLength(2);
  const [kept, preset] = player.sent('/Alarms?hour').map((c) => Object.fromEntries(new URL(`http://x${c}`).searchParams));
  expect(kept).toMatchObject({ source: 'Current play queue or station', url: 'TuneIn:x', image: '' });
  expect(preset).toMatchObject({ source: 'Chill', url: '/Load?name=Chill', image: '' });
});

test('ブラウズ: 応答に browse が無い', async ({ page, player }) => {
  player.on('/api/browse', () => ({}));
  await page.goto('/');
  await page.click('[data-tab="browse"]');
  await expect(page.locator('#browse')).toHaveText('項目がありません');
});

test('ブラウズ: 名前の無い項目と分類', async ({ page, player }) => {
  player.browse[''] = { item: [{ text: 'Go', browseKey: 'k' }] };
  player.browse.k = { item: [{ contextMenuKey: 'LocalMusic:CM/LocalMusic-Album?album=A' }], category: [{ item: [{ text: 'x' }] }] };
  player.addToPlaylistOptions = { urlPath: '/AddToPlaylist', requestParameter: 'a=1', playlists: { name: [{}] } };
  await page.goto('/');
  await page.click('[data-tab="browse"]');
  await page.locator('#browse').getByText('Go').click();
  await expect(page.locator('#browse .cat-title')).toHaveText('');
  await expect(page.locator('#browse .row-title').first()).toHaveText('');
  // アーティストの無いアルバムのメニュー・名前の無いプレイリスト候補
  await page.locator('#browse .row').first().locator('[title="メニュー"]').click();
  await expect(page.locator('#menuTitle')).toHaveText('');
  await chooseMenu(page, 'プレイリストに追加…');
  await expect(page.locator('#menuItems button')).toHaveText(['']);
  expect(player.sent('/AddToPlaylistOptions')).toEqual(['/AddToPlaylistOptions?artist=&album=A']);
});

test('ブラウズ: 戻った後に遅れて成功した応答も捨てる', async ({ page, player }) => {
  player.browse[''] = { item: [{ text: 'Slow', browseKey: 'slow' }] };
  player.browse.slow = { item: [{ text: 'SLOW-ITEM' }] };
  let release;
  player.on('/api/browse', async (u) => {
    if (u.searchParams.get('key') === 'slow') await new Promise((r) => (release = r));
    return player.defaultResponse('/api/browse', u);
  });
  await page.goto('/');
  await page.click('[data-tab="browse"]');
  await page.locator('#browse').getByText('Slow').click();
  await expect.poll(() => typeof release).toBe('function');
  await page.click('#btnBrowseBack');
  await expect(page.locator('#browse')).toContainText('Slow');
  release();
  await page.waitForTimeout(200);
  await expect(page.locator('#browse')).not.toContainText('SLOW-ITEM');
});
