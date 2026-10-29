// 再生中の表示と操作
import { test, expect, expectToast, answerDialog, chooseMenu, fail } from './fixtures.js';

const ON = /(^|\s)on(\s|$)/; // class の on（icon などに一致させない）

test.describe('再生中の表示', () => {
  test('曲情報・デバイス名・各ボタンの状態を表示する', async ({ page, player }) => {
    Object.assign(player.status, { state: 'play', shuffle: '1', repeat: '1', mute: '1', sleep: '30', isFavourite: '1', indexing: '1' });
    await page.goto('/');
    await expect(page.locator('#title')).toHaveText('Song 0');
    await expect(page.locator('#subtitle')).toHaveText('Artist 0 • Album 0');
    await expect(page).toHaveTitle('Song 0 — BluOS');
    await expect(page.locator('#deviceName')).toHaveText('Living Room');
    await expect(page.locator('#deviceModel')).toHaveText('Bluesound NODE');
    await expect(page.locator('#conn')).toHaveClass(/ok/);
    await expect(page.locator('#art')).toHaveAttribute('src', '/api/d/Artwork?service=LocalMusic&fn=%2Fmusic%2F0.flac');
    await expect(page.locator('#service')).toHaveText('Library');
    await expect(page.locator('#quality')).toHaveText('FLAC 44.1kHz/16bit');
    await expect(page.locator('#btnPlay')).toHaveClass(/playing/);
    await expect(page.locator('#btnShuffle')).toHaveClass(ON);
    await expect(page.locator('#btnRepeat')).toHaveClass(/one/);
    await expect(page.locator('#btnMute')).toHaveClass(/muted-on/);
    await expect(page.locator('#sleepValue')).toHaveText('30');
    await expect(page.locator('#btnSleep')).toHaveAttribute('title', 'スリープタイマー: 残り 30 分');
    await expect(page.locator('#btnFav')).toHaveClass(ON);
    await expect(page.locator('#indexing')).toBeVisible();
    await expect(page.locator('#total')).toHaveText('3:20');
    await expect(page.locator('#volumeValue')).toHaveText('25');
    // 再生中は経過時間が進む
    await expect(page.locator('#elapsed')).not.toHaveText('0:10');
  });

  test('外部 URL の画像・停止中・タイトル無しの表示', async ({ page, player }) => {
    Object.assign(player.status, {
      state: 'stop', title1: undefined, title2: undefined, title3: undefined, name: undefined,
      image: 'https://example.com/a.jpg', serviceName: undefined, service: 'Capture', fn: undefined, totlen: '0',
      volume: 'x', song: undefined,
    });
    player.on('/SyncStatus', () => ({ SyncStatus: {} }));
    await page.goto('/');
    await expect(page.locator('#title')).toHaveText('停止中');
    await expect(page).toHaveTitle('BluOS');
    await expect(page.locator('#deviceName')).toHaveText('BluOS');
    await expect(page.locator('#art')).toHaveAttribute('src', 'https://example.com/a.jpg');
    await expect(page.locator('#service')).toHaveText('Capture');
    await expect(page.locator('#btnFav')).toBeHidden();
    await expect(page.locator('#btnNpMenu')).toBeHidden();
    await expect(page.locator('#seek')).toBeDisabled();
    await expect(page.locator('#total')).toHaveText('');
    await expect(page.locator('#volumeValue')).toHaveText('0');
  });

  test('画像なし・一時停止中で title2 が無い時はアーティストとアルバム', async ({ page, player }) => {
    Object.assign(player.status, { image: undefined, title1: 'Name', title2: 'Name', title3: undefined });
    await page.goto('/');
    await expect(page.locator('#subtitle')).toHaveText('Artist 0 • Album 0');
    await expect(page.locator('#art')).not.toHaveAttribute('src');
    // 曲が変わったら表示を更新し、キューの強調も移る
    player.setStatus({ song: '1', title1: 'Song 1', state: 'play', secs: '7200', totlen: '0', image: '/Artwork?x=1' });
    await expect(page.locator('#title')).toHaveText('Song 1');
    await expect(page.locator('#queue .row.current')).toHaveAttribute('data-id', '1');
    await expect(page.locator('#elapsed')).toHaveText(/^2:00:0\d$/);
  });

  test('状態の取得に失敗したら接続表示を変えて再試行する', async ({ page, player }) => {
    let n = 0;
    player.on('/Status', async () => (++n === 1 ? fail('down') : { status: { ...player.status } }));
    player.on('/SyncStatus', () => fail('down'));
    await page.goto('/');
    await expect(page.locator('#conn')).toHaveClass(/ng/);
    await expect(page.locator('#conn')).toHaveClass(/ok/, { timeout: 10_000 });
    await expect(page.locator('#title')).toHaveText('Song 0');
  });
});

test.describe('再生操作', () => {
  test('再生/一時停止・前後・シャッフル・リピート・ミュート', async ({ page, player }) => {
    await page.goto('/');
    await expect(page.locator('#title')).toHaveText('Song 0');
    await page.click('#btnPlay');
    await expect.poll(() => player.sent('/Play')).toContain('/Play');
    player.setStatus({ state: 'play' });
    await expect(page.locator('#btnPlay')).toHaveClass(/playing/);
    await page.click('#btnPlay');
    await expect.poll(() => player.sent('/Pause')).toContain('/Pause');
    await page.click('#btnSkip');
    await page.click('#btnBack');
    await page.click('#btnShuffle');
    await page.click('#btnMute');
    await expect.poll(() => player.calls).toEqual(expect.arrayContaining(['/Skip', '/Back', '/Shuffle?state=1', '/Volume?mute=1']));
    // リピート: オフ → 全体 → 1 曲 → オフ
    for (const [cur, next] of [['2', '0'], ['0', '1'], ['1', '2']]) {
      player.setStatus({ repeat: cur });
      if (cur === '2') await expect(page.locator('#btnRepeat')).not.toHaveClass(ON);
      else await expect(page.locator('#btnRepeat')).toHaveClass(ON);
      await page.click('#btnRepeat');
      await expect.poll(() => player.calls).toContain(`/Repeat?state=${next}`);
    }
    player.setStatus({ shuffle: '1', mute: '1' });
    await expect(page.locator('#btnShuffle')).toHaveClass(ON);
    await page.click('#btnShuffle');
    await page.click('#btnMute');
    await expect.poll(() => player.calls).toEqual(expect.arrayContaining(['/Shuffle?state=0', '/Volume?mute=0']));
  });

  test('操作に失敗したらエラーを表示する', async ({ page, player }) => {
    player.on('/Skip', () => fail('busy'));
    await page.goto('/');
    await page.click('#btnSkip');
    await expectToast(page, 'エラー: busy');
  });

  test('音量とシーク', async ({ page, player }) => {
    await page.goto('/');
    await expect(page.locator('#title')).toHaveText('Song 0');
    await page.locator('#volume').fill('40');
    await expect(page.locator('#volumeValue')).toHaveText('40');
    await expect.poll(() => player.calls).toContain('/Volume?level=40');
    // 操作直後に届いた状態では音量表示を戻さない
    player.setStatus({ volume: '25' });
    await expect(page.locator('#volumeValue')).toHaveText('40');
    await page.locator('#seek').fill('120');
    await expect(page.locator('#elapsed')).toHaveText('2:00');
    await expect.poll(() => player.calls).toContain('/Play?seek=120');
  });

  test('お気に入りの登録と解除', async ({ page, player }) => {
    await page.goto('/');
    await page.click('#btnFav');
    await expectToast(page, 'お気に入りに追加しました');
    await expect(page.locator('#btnFav')).toHaveClass(ON);
    await page.click('#btnFav');
    await expectToast(page, 'お気に入りから削除しました');
    await expect(page.locator('#btnFav')).not.toHaveClass(ON);
    expect(player.sent(/Favourite/)).toEqual([
      '/AddFavourite?fn=%2Fmusic%2F0.flac&service=LocalMusic',
      '/DeleteFavourite?fn=%2Fmusic%2F0.flac&service=LocalMusic',
    ]);
  });

  test('お気に入りに失敗したら表示を変えない。お気に入りタブを開いていれば読み直す', async ({ page, player }) => {
    player.on('/AddFavourite', () => fail('nope'));
    await page.goto('/');
    await page.click('[data-tab="favourites"]');
    await page.click('#btnFav');
    await expectToast(page, 'エラー: nope');
    await expect(page.locator('#btnFav')).not.toHaveClass(ON);
    player.on('/AddFavourite', () => ({}));
    const before = player.sent('/api/browse').length;
    await page.click('#btnFav');
    await expect(page.locator('#btnFav')).toHaveClass(ON);
    await expect.poll(() => player.sent('/api/browse').length).toBeGreaterThan(before);
  });

  test('曲情報が無い時はお気に入りを押しても何もしない', async ({ page, player }) => {
    await page.goto('/');
    await expect(page.locator('#title')).toHaveText('Song 0');
    player.setStatus({ fn: undefined, streamUrl: undefined });
    await expect(page.locator('#btnFav')).toBeHidden();
    await page.locator('#btnFav').evaluate((b) => b.click());
    await page.locator('#btnNpMenu').evaluate((b) => b.click());
    await expect(page.locator('#menu')).toBeHidden();
    expect(player.sent(/Favourite/)).toEqual([]);
  });
});

test.describe('スリープタイマー', () => {
  test('目的の値になるまで /Sleep を呼ぶ', async ({ page, player }) => {
    await page.goto('/');
    await page.click('#btnSleep');
    await expect(page.locator('#menuTitle')).toHaveText('スリープタイマー');
    await expect(page.locator('#menuItems button')).toHaveText(['15 分', '30 分', '45 分', '60 分', '90 分']);
    await chooseMenu(page, '45 分');
    await expectToast(page, 'スリープタイマー: 45 分');
    expect(player.sent('/Sleep')).toHaveLength(3);
  });

  test('設定中ならオフを選べる', async ({ page, player }) => {
    player.status.sleep = '45';
    player.sleepIndex = 2;
    await page.goto('/');
    await page.click('#btnSleep');
    await expect(page.locator('#menuTitle')).toHaveText('スリープタイマー（残り 45 分）');
    await chooseMenu(page, 'オフ');
    await expectToast(page, 'スリープタイマーを解除しました');
  });

  test('値が変わらなければ諦める・エラー', async ({ page, player }) => {
    player.on('/Sleep', () => ({ sleep: '15' }));
    await page.goto('/');
    await page.click('#btnSleep');
    await chooseMenu(page, '30 分');
    await expectToast(page, 'スリープタイマーを設定できませんでした');
    player.on('/Sleep', () => fail('x'));
    await page.click('#btnSleep');
    await chooseMenu(page, '30 分');
    await expectToast(page, 'エラー: x');
  });
});

test.describe('ストリーミングラジオ', () => {
  const radio = {
    streamUrl: 'RadioParadise:/0', service: 'RadioParadise', fn: undefined, title1: 'Station', name: 'Station',
    stationImage: '/station.png', song: undefined,
    actions: { action: [
      { name: 'skip', url: '/Action?service=RadioParadise&skip=1', notification: 'スキップしました' },
      { name: 'back' },
      { name: 'love', url: '/Action?love=1', text: 'Love it', state: '1' },
      { name: 'ban', url: '/Action?ban=1' },
    ] },
  };

  test('actions の URL で操作し、URL の無い操作は無効にする', async ({ page, player }) => {
    Object.assign(player.status, radio);
    player.on('/Action', (u) => (u.searchParams.get('ban') ? { response: 'Banned' } : u.searchParams.get('love') ? fail('x') : {}));
    await page.goto('/');
    await expect(page.locator('#btnBack')).toBeDisabled();
    await expect(page.locator('#btnSkip')).toBeEnabled();
    await expect(page.locator('#btnLove')).toBeVisible();
    await expect(page.locator('#btnLove')).toHaveAttribute('title', 'Love it');
    await expect(page.locator('#btnLove')).toHaveClass(ON);
    await page.click('#btnSkip');
    await expectToast(page, 'スキップしました');
    await page.click('#btnBan');
    await expectToast(page, 'Banned');
    await page.click('#btnLove');
    await expectToast(page, 'エラー: x');
    await page.locator('#btnBack').evaluate((b) => b.click()); // 無効な操作は何も送らない
    expect(player.sent('/Back')).toEqual([]);
    expect(player.sent('/Skip')).toEqual([]);
  });

  test('actions が無ければ操作しない。メニューからプリセットに追加できる', async ({ page, player }) => {
    Object.assign(player.status, radio, { actions: undefined, image: '/img.png', stationImage: undefined, title1: undefined });
    await page.goto('/');
    await expect(page.locator('#btnSkip')).toBeDisabled();
    await expect(page.locator('#btnLove')).toBeHidden();
    await page.locator('#btnSkip').evaluate((b) => b.click());
    await page.locator('#btnLove').evaluate((b) => b.click());
    await page.locator('#btnBan').evaluate((b) => b.click());
    await page.click('#btnNpMenu');
    await expect(page.locator('#menuItems button')).toHaveText(['プリセットに追加']);
    await chooseMenu(page, 'プリセットに追加');
    await expectToast(page, '「Station」をプリセットに追加しました');
    expect(player.sent('/SetPreset')).toEqual(['/SetPreset?name=Station&url=RadioParadise%3A%2F0&image=%2Fimg.png']);
  });
});

test.describe('再生中の曲のメニュー', () => {
  test('ライブラリの曲の操作', async ({ page, player }) => {
    player.menus = {};
    await page.goto('/');
    await page.click('#btnNpMenu');
    await expect(page.locator('#menuItems button')).toHaveText([
      'お気に入りに追加', 'プレイリストに追加…', 'アルバムへ移動', 'アーティストへ移動', '曲情報（last.fm）', '技術情報',
    ]);
    await chooseMenu(page, 'お気に入りに追加');
    await expectToast(page, 'お気に入りに追加しました');

    // 技術情報は iframe で表示し、閉じると空にする
    await page.click('#btnNpMenu');
    await chooseMenu(page, '技術情報');
    await expect(page.locator('#info')).toBeVisible();
    await expect(page.locator('#infoTitle')).toHaveText('Song 0');
    await expect(page.locator('#infoFrame')).toHaveAttribute('src', '/api/d/Info?filename=%2Fmusic%2F0.flac&service=LocalMusic&category=technical');
    await page.click('#infoClose');
    await expect(page.locator('#info')).toBeHidden();
    await expect(page.locator('#infoFrame')).toHaveAttribute('src', 'about:blank');

    // 曲情報は別ウィンドウ
    await page.click('#btnNpMenu');
    const popup = page.waitForEvent('popup');
    await chooseMenu(page, '曲情報（last.fm）');
    expect((await popup).url()).toContain('/api/d/Info?service=LocalMusic&artist=Artist+0&album=Album+0&title=Song+0');

    // アルバム・アーティストへ移動はブラウズタブで開く
    player.browse['LocalMusic:MG/LocalMusic-Album?album=Album+0&artist=Artist+0'] = { item: [{ text: 'Track A' }] };
    await page.click('#btnNpMenu');
    await chooseMenu(page, 'アルバムへ移動');
    await expect(page.locator('#tab-browse')).toBeVisible();
    await expect(page.locator('#crumbs')).toHaveText('ソース › Library › Album 0');
    await expect(page.locator('#browse')).toContainText('Track A');
    await page.click('#btnNpMenu');
    await chooseMenu(page, 'アーティストへ移動');
    await expect(page.locator('#crumbs')).toHaveText('ソース › Library › Artist 0');
    await expect.poll(() => player.sent('/api/browse?key=LocalMusic%3AMG%2FLocalMusic-Artist')).toHaveLength(1);
  });

  test('お気に入り登録済みの曲は削除だけ出す', async ({ page, player }) => {
    player.status.isFavourite = '1';
    await page.goto('/');
    await page.click('#btnNpMenu');
    await expect(page.locator('#menuItems button').first()).toHaveText('お気に入りから削除');
    await chooseMenu(page, 'お気に入りから削除');
    await expectToast(page, 'お気に入りから削除しました');
  });

  test('ライブラリ以外の曲はプレイリストに追加だけ', async ({ page, player }) => {
    Object.assign(player.status, { service: 'Amazon', fn: 'Amazon:123' });
    await page.goto('/');
    await page.click('#btnNpMenu');
    await expect(page.locator('#menuItems button')).toHaveText(['プレイリストに追加…']);
  });

  test('プレイリストに追加（既存・新規・取り消し）', async ({ page, player }) => {
    await page.goto('/');
    await page.click('#btnNpMenu');
    await chooseMenu(page, 'プレイリストに追加…');
    await expect(page.locator('#menuTitle')).toHaveText('「Song 0」をプレイリストに追加');
    await expect(page.locator('#menuItems button')).toHaveText(['Chill', 'Rock & Roll', '＋ 新しいプレイリスト…']);
    await chooseMenu(page, 'Rock & Roll');
    await expectToast(page, '「Rock & Roll」に追加しました');
    expect(player.sent('/AddToPlaylistOptions')).toEqual(['/AddToPlaylistOptions?songid=%2Fmusic%2F0.flac']);
    expect(player.sent('/AddToPlaylist?')).toEqual(['/AddToPlaylist?songid=x&service=LocalMusic&name=Rock%20%26%20Roll']);

    await page.click('#btnNpMenu');
    await chooseMenu(page, 'プレイリストに追加…');
    answerDialog(page, ' New List ');
    await chooseMenu(page, '＋ 新しいプレイリスト…');
    await expectToast(page, '「New List」に追加しました');

    await page.click('#btnNpMenu');
    await chooseMenu(page, 'プレイリストに追加…');
    answerDialog(page, null);
    await chooseMenu(page, '＋ 新しいプレイリスト…');
    await expect(page.locator('#menu')).toBeHidden();
    expect(player.sent('/AddToPlaylist?')).toHaveLength(2);
  });

  test('新規作成できない保存先・候補の取得失敗', async ({ page, player }) => {
    player.addToPlaylistOptions = { urlPath: '/AddToPlaylist', requestParameter: 'songid=x', playlists: { name: 'Only' } };
    await page.goto('/');
    await page.click('#btnNpMenu');
    await chooseMenu(page, 'プレイリストに追加…');
    await expect(page.locator('#menuItems button')).toHaveText(['Only']);
    await chooseMenu(page, 'Only');
    await expect.poll(() => player.sent('/AddToPlaylist?')).toEqual(['/AddToPlaylist?songid=x&service=LocalMusic&name=Only']);

    player.addToPlaylistOptions = { urlPath: '/AddToPlaylist', requestParameter: 'songid=x' };
    await page.click('#btnNpMenu');
    await chooseMenu(page, 'プレイリストに追加…');
    await expect(page.locator('#menuItems')).toHaveText('操作はありません');
    await page.click('#menuCancel');

    player.on('/AddToPlaylistOptions', () => fail('no options'));
    await page.click('#btnNpMenu');
    await chooseMenu(page, 'プレイリストに追加…');
    await expect(page.locator('#menuItems')).toHaveText('取得できません: no options');
  });
});

test.describe('全画面表示', () => {
  test('ボタンで開き、戻るで閉じる', async ({ page }) => {
    await page.goto('/');
    await page.click('#btnFull');
    await expect(page.locator('body')).toHaveClass(/np-full/);
    expect(new URL(page.url()).hash).toBe('#nowplaying');
    // アートワークのタップで操作 UI を隠す
    await page.click('#artWrap');
    await expect(page.locator('body')).toHaveClass(/np-ui-hidden/);
    await page.goBack();
    await expect(page.locator('body')).not.toHaveClass(/np-full/);
  });

  test('閉じるボタン・Esc・アートワークのクリック', async ({ page }) => {
    await page.goto('/');
    await page.click('#artWrap');
    await expect(page.locator('body')).toHaveClass(/np-full/);
    await page.click('#btnFullClose');
    await expect(page.locator('body')).not.toHaveClass(/np-full/);
    expect(new URL(page.url()).hash).toBe('');
    await page.click('#btnFull');
    await expect(page.locator('body')).toHaveClass(/np-full/);
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).not.toHaveClass(/np-full/);
  });

  test('URL の #nowplaying で直接開き、閉じると履歴を戻さずに外す', async ({ page }) => {
    await page.goto('/#nowplaying');
    await expect(page.locator('body')).toHaveClass(/np-full/);
    // 既に #nowplaying の時のボタンは表示だけ切り替える
    await page.evaluate(() => document.body.classList.remove('np-full'));
    await page.locator('#btnFull').evaluate((b) => b.click());
    await expect(page.locator('body')).toHaveClass(/np-full/);
    await page.click('#btnFullClose');
    await expect(page.locator('body')).not.toHaveClass(/np-full/);
    expect(new URL(page.url()).hash).toBe('');
    // 全画面でない時に閉じても何もしない
    await page.locator('#btnFullClose').evaluate((b) => b.click());
    await expect(page.locator('body')).not.toHaveClass(/np-full/);
  });

  test('Wake Lock を取得し、閉じたら解放する。取得中に閉じたらすぐ解放する', async ({ page }) => {
    await page.addInitScript(() => {
      window.__locks = { requested: 0, released: 0 };
      let delay = 0;
      window.__setLockDelay = (ms) => (delay = ms);
      Object.defineProperty(navigator, 'wakeLock', {
        value: {
          request: () => {
            window.__locks.requested++;
            const lock = { release: async () => { window.__locks.released++; } };
            return new Promise((r) => setTimeout(() => r(lock), delay));
          },
        },
      });
    });
    await page.goto('/');
    await page.click('#btnFull');
    await expect.poll(() => page.evaluate(() => window.__locks.requested)).toBe(1);
    // タブが再表示されたら取り直す（前のロックは解放）
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(() => page.evaluate(() => window.__locks)).toEqual({ requested: 2, released: 1 });
    await page.click('#btnFullClose');
    await expect.poll(() => page.evaluate(() => window.__locks.released)).toBe(2);

    await page.evaluate(() => window.__setLockDelay(300));
    await page.click('#btnFull');
    await page.click('#btnFullClose');
    await expect.poll(() => page.evaluate(() => window.__locks)).toEqual({ requested: 3, released: 3 });
  });

  test('Wake Lock が使えなくても開ける', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'wakeLock', { value: { request: () => Promise.reject(new Error('denied')) } });
    });
    await page.goto('/');
    await page.click('#btnFull');
    await expect(page.locator('body')).toHaveClass(/np-full/);
    // 隠れている時の visibilitychange では取り直さない
    await page.click('#btnFullClose');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  });
});
