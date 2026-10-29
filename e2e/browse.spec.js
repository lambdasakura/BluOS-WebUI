// ブラウズ・フォルダ表示・ブラウズ項目のメニュー
import { test, expect, expectToast, answerDialog, chooseMenu, fail } from './fixtures.js';

const NEW = 'LocalMusic:Album/%2Flibrary%2Fv1%2FAlbums%3Frecent%3D1%26service%3DLocalMusic';

test.beforeEach(async ({ player }) => {
  player.browse[''] = { item: [
    { text: 'Library', browseKey: 'LocalMusic:', image: '/lib.png' },
    { text: 'TuneIn', browseKey: 'TuneIn:' },
  ] };
  player.browse['LocalMusic:'] = {
    searchKey: 'LocalMusic:search', serviceName: 'Library',
    item: [
      { text: 'Artists', type: 'section', browseKey: 'LocalMusic:artists', text2: '120' },
      { text: 'Albums', type: 'section', browseKey: 'LocalMusic:albums' },
    ],
  };
  player.browse['LocalMusic:albums'] = {
    playURL: '/Add?all=1', nextKey: 'albums-2',
    item: [
      { text: 'Album A', browseKey: 'album-a', playURL: '/Add?album=a', contextMenuKey: 'LocalMusic:CM/LocalMusic-Album?album=A&artist=X' },
      { text: 'Track T', autoplayURL: '/Add?track=t', contextMenuKey: 'LocalMusic:CM/LocalMusic-Song?filename=%2Fm%2Ft.flac', duration: '61' },
      { text: 'Plain' },
    ],
    category: [{ text: 'Singles', item: [{ text: 'Single S' }] }],
  };
  player.browse['albums-2'] = { nextKey: 'albums-3', item: [{ text: 'Album B' }], category: [{ text: 'More', item: [{ text: 'Album C' }] }] };
  player.browse['albums-3'] = { item: [{ text: 'Album D' }] };
});

async function openBrowse(page) {
  await page.goto('/');
  await page.click('[data-tab="browse"]');
  await expect(page.locator('#browse')).toContainText('Library');
}

test('ソースから辿り、戻る・パンくず・セクション表示', async ({ page, player }) => {
  await openBrowse(page);
  await expect(page.locator('#crumbs')).toHaveText('ソース');
  await expect(page.locator('#btnBrowseBack')).toBeHidden();
  await page.locator('#browse').getByText('Library').click();
  await expect(page.locator('#crumbs')).toHaveText('ソース › Library');
  await expect(page.locator('#browse .sections button')).toHaveText(['Artists120', 'Albums']);
  await expect(page.locator('#searchForm')).toBeVisible();
  // ライブラリには New・Folders・再スキャンを足す
  await expect(page.locator('#browse')).toContainText('最近追加されたアルバム');
  await page.locator('#browse .sections button', { hasText: 'Albums' }).click();
  await expect(page.locator('#crumbs')).toHaveText('ソース › Library › Albums');
  await expect(page.locator('#searchForm')).toBeHidden();
  await expect(page.locator('#browse .cat-title')).toHaveText('Singles');
  await page.click('#btnBrowseBack');
  await page.click('#btnBrowseBack');
  await expect(page.locator('#crumbs')).toHaveText('ソース');
  // タブを切り替えて戻っても読み直さない
  const n = player.sent('/api/browse').length;
  await page.click('[data-tab="queue"]');
  await page.click('[data-tab="browse"]');
  await expect(page.locator('#crumbs')).toHaveText('ソース');
  expect(player.sent('/api/browse')).toHaveLength(n);
});

test('項目の再生・すべて再生・さらに読み込む', async ({ page, player }) => {
  await openBrowse(page);
  await page.locator('#browse').getByText('Library').click();
  await page.locator('#browse .sections button', { hasText: 'Albums' }).click();
  await page.locator('#browseActions').getByText('▶ すべて再生').click();
  await expectToast(page, '再生します');
  await page.locator('#browse .row', { hasText: 'Album A' }).locator('[title="再生"]').click();
  await page.locator('#browse').getByText('Track T').click();
  await expectToast(page, 'Track T を再生');
  await page.locator('#browse').getByText('Plain').click(); // 何も起きない
  expect(player.sent('/Add')).toEqual(['/Add?all=1', '/Add?album=a', '/Add?track=t']);
  await expect(page.locator('#browse')).toContainText('1:01');

  // さらに読み込む（続きがある間はボタンを残す）
  await page.locator('#browse').getByText('さらに読み込む').click();
  await expect(page.locator('#browse')).toContainText('Album C');
  await page.locator('#browse').getByText('さらに読み込む').click();
  await expect(page.locator('#browse')).toContainText('Album D');
  await expect(page.locator('#browse').getByText('さらに読み込む')).toHaveCount(0);
});

test('さらに読み込むの失敗・読み込み中に移動', async ({ page, player }) => {
  await openBrowse(page);
  await page.locator('#browse').getByText('Library').click();
  await page.locator('#browse .sections button', { hasText: 'Albums' }).click();
  player.on('/api/browse', () => fail('x'));
  await page.locator('#browse').getByText('さらに読み込む').click();
  await expectToast(page, 'エラー: x');
  await expect(page.locator('#browse').getByText('さらに読み込む')).toBeEnabled();

  let release;
  player.on('/api/browse', async (u) => {
    if (u.searchParams.get('key') === 'albums-2') await new Promise((r) => (release = r));
    return player.defaultResponse('/api/browse', u);
  });
  await page.locator('#browse').getByText('さらに読み込む').click();
  await expect.poll(() => typeof release).toBe('function');
  await page.click('#btnBrowseBack');
  await expect(page.locator('#browse .sections')).toBeVisible();
  release();
  await page.waitForTimeout(200);
  await expect(page.locator('#browse')).not.toContainText('Album B');
});

test('検索', async ({ page, player }) => {
  player.browse['LocalMusic:search?q=abc'] = { item: [{ text: 'Found' }] };
  await openBrowse(page);
  await page.locator('#browse').getByText('Library').click();
  await page.click('#searchForm button'); // 空なら送らない
  await page.fill('#searchInput', ' abc ');
  await page.press('#searchInput', 'Enter');
  await expect(page.locator('#crumbs')).toHaveText('ソース › Library › 検索「abc」');
  await expect(page.locator('#browse')).toContainText('Found');
  await expect(page.locator('#searchInput')).toHaveValue(' abc ');
  expect(player.sent('/api/browse?key=LocalMusic%3Asearch')).toEqual(['/api/browse?key=LocalMusic%3Asearch&q=abc']);
});

test('遅れて届いた応答・取得失敗', async ({ page, player }) => {
  let release;
  player.on('/api/browse', async (u) => {
    if (u.searchParams.get('key') === 'TuneIn:') {
      await new Promise((r) => (release = r));
      return fail('late');
    }
    return player.defaultResponse('/api/browse', u);
  });
  await openBrowse(page);
  await page.locator('#browse').getByText('TuneIn').click();
  await expect(page.locator('#browse')).toHaveText('読み込み中…');
  await page.click('#btnBrowseBack');
  await expect(page.locator('#browse')).toContainText('Library');
  release();
  await page.waitForTimeout(200);
  await expect(page.locator('#browse')).toContainText('Library');

  player.on('/api/browse', (u) => (u.searchParams.get('key') === 'TuneIn:' ? fail('no tunein') : player.defaultResponse('/api/browse', u)));
  await page.locator('#browse').getByText('TuneIn').click();
  await expect(page.locator('#browse')).toHaveText('取得できません: no tunein');
  player.browse['TuneIn:'] = {};
  player.handlers.delete('/api/browse');
  await page.click('#btnBrowseBack');
  await page.locator('#browse').getByText('TuneIn').click();
  await expect(page.locator('#browse')).toHaveText('項目がありません');
});

test('ライブラリの New・再スキャン', async ({ page, player }) => {
  player.browse[NEW] = { item: [{ text: 'Brand New' }] };
  await openBrowse(page);
  await page.locator('#browse').getByText('Library').click();
  answerDialog(page, null);
  await page.locator('#browse').getByText('ライブラリを再スキャン').click();
  answerDialog(page);
  await page.locator('#browse').getByText('ライブラリを再スキャン').click();
  await expectToast(page, '再スキャンを開始しました');
  expect(player.sent('/Reindex')).toHaveLength(1);
  await page.locator('#browse .row', { hasText: 'New' }).first().click();
  await expect(page.locator('#browse')).toContainText('Brand New');
});

test.describe('フォルダ', () => {
  test.beforeEach(async ({ player }) => {
    player.folders[''] = { subfolders: { folder: ['//nas/music'] } };
    player.folders['//nas/music'] = {
      subfolders: { folder: ['Jazz', 123] },
      songs: { song: [{ fn: '//nas/music/a.flac', title: 'A', art: 'X', alb: 'Y', time: '90' }, { fn: '//nas/music/b.flac' }] },
    };
  });

  test('フォルダを辿り、フォルダ・曲を操作する', async ({ page, player }) => {
    await openBrowse(page);
    await page.locator('#browse').getByText('Library').click();
    await page.locator('#browse .row', { hasText: 'Folders' }).click();
    await expect(page.locator('#crumbs')).toHaveText('ソース › Library › Folders');
    await expect(page.locator('#browseActions')).toBeHidden();
    await expect(page.locator('#searchForm')).toBeHidden();
    await page.locator('#browse').getByText('//nas/music').click();
    await expect(page.locator('#browse .row-title')).toHaveText(['Jazz', '123', 'A', 'b.flac']);
    await expect(page.locator('#browse')).toContainText('X • Y');
    await expect(page.locator('#browseActions button')).toHaveText(['再生', 'シャッフル再生', '最後に追加']);
    await page.locator('#browseActions button', { hasText: 'シャッフル再生' }).click();
    await expectToast(page, '「//nas/music」をシャッフル再生');

    // フォルダのメニュー・曲のクリックとメニュー
    await page.locator('#browse .row', { hasText: 'Jazz' }).locator('[title="メニュー"]').click();
    await expect(page.locator('#menuTitle')).toHaveText('Jazz');
    await chooseMenu(page, '最後に追加');
    await page.locator('#browse .row', { hasText: 'A' }).filter({ hasText: 'X • Y' }).click();
    await expectToast(page, 'A を再生');
    await page.locator('#browse .row', { hasText: 'A' }).filter({ hasText: 'X • Y' }).locator('[title="メニュー"]').click();
    await expect(page.locator('#menuItems button')).toHaveText([
      '再生', '次に追加', '最後に追加', 'お気に入りに追加', 'お気に入りから削除', 'プレイリストに追加…', 'アルバムへ移動', 'アーティストへ移動', '曲情報（last.fm）', '技術情報',
    ]);
    await chooseMenu(page, '次に追加');
    await page.locator('#browse .row', { hasText: 'A' }).filter({ hasText: 'X • Y' }).locator('[title="メニュー"]').click();
    await chooseMenu(page, '最後に追加');
    await page.locator('#browseActions button', { hasText: '再生' }).first().click();
    expect(player.sent('/Add')).toEqual([
      '/Add?service=LocalMusic&path=%2F%2Fnas%2Fmusic&playnow=1&shuffle=1&where=next',
      '/Add?service=LocalMusic&path=%2F%2Fnas%2Fmusic%2FJazz&playnow=-1',
      '/Add?service=LocalMusic&file=%2F%2Fnas%2Fmusic%2Fa.flac&playnow=1&clear=0&where=next',
      '/Add?service=LocalMusic&file=%2F%2Fnas%2Fmusic%2Fa.flac&playnow=-1&where=next',
      '/Add?service=LocalMusic&file=%2F%2Fnas%2Fmusic%2Fa.flac&playnow=-1&where=last',
      '/Add?service=LocalMusic&path=%2F%2Fnas%2Fmusic&playnow=1&clear=0&shuffle=0&where=next',
    ]);

    // 下の階層は親からの相対名を連結する
    await page.locator('#browse').getByText('Jazz').first().click();
    await expect(page.locator('#browse')).toHaveText('項目がありません');
    expect(player.sent('/library/v1/Folders')).toContain('/library/v1/Folders?service=LocalMusic&path=%2F%2Fnas%2Fmusic%2FJazz');
  });

  test('取得失敗・読み込み中の移動', async ({ page, player }) => {
    await openBrowse(page);
    await page.locator('#browse').getByText('Library').click();
    player.on('/library/v1/Folders', () => fail('no nas'));
    await page.locator('#browse .row', { hasText: 'Folders' }).click();
    await expect(page.locator('#browse')).toHaveText('取得できません: no nas');

    let release;
    player.on('/library/v1/Folders', async (u) => {
      await new Promise((r) => (release = r));
      return player.defaultResponse('/library/v1/Folders', u);
    });
    await page.click('#btnBrowseBack');
    await page.locator('#browse .row', { hasText: 'Folders' }).click();
    await expect.poll(() => typeof release).toBe('function');
    await page.click('#btnBrowseBack');
    await expect(page.locator('#browse')).toContainText('最近追加されたアルバム');
    release();
    await page.waitForTimeout(200);
    await expect(page.locator('#browse')).toContainText('最近追加されたアルバム');
  });
});

test.describe('ブラウズ項目のメニュー', () => {
  test('プレーヤーのメニューと「プレイリストに追加」', async ({ page, player }) => {
    player.menus['LocalMusic:CM/LocalMusic-Album?album=A&artist=X'] = { item: [
      { text: 'Play now', actionURL: '/Add?album=a&playnow=1' },
      { text: 'Go to artist', browseKey: 'artist-x' },
      { text: 'Nothing' },
    ] };
    player.browse['artist-x'] = { item: [{ text: 'Artist X page' }] };
    await openBrowse(page);
    await page.locator('#browse').getByText('Library').click();
    await page.locator('#browse .sections button', { hasText: 'Albums' }).click();
    const albumMenu = page.locator('#browse .row', { hasText: 'Album A' }).locator('[title="メニュー"]');
    await albumMenu.click();
    await expect(page.locator('#menuTitle')).toHaveText('Album A');
    await expect(page.locator('#menuItems button')).toHaveText(['Play now', 'Go to artist', 'Nothing', 'プレイリストに追加…']);
    await chooseMenu(page, 'Play now');
    await expectToast(page, 'Play now: Album A');
    await albumMenu.click();
    await chooseMenu(page, 'Nothing');
    await albumMenu.click();
    await chooseMenu(page, 'プレイリストに追加…');
    await expect(page.locator('#menuTitle')).toHaveText('「Album A」をプレイリストに追加');
    await page.click('#menuCancel');
    expect(player.sent('/AddToPlaylistOptions')).toEqual(['/AddToPlaylistOptions?artist=X&album=A']);

    await page.locator('#browse .row', { hasText: 'Track T' }).locator('[title="メニュー"]').click();
    await expect(page.locator('#menuItems')).toHaveText('プレイリストに追加…'); // プレーヤーのメニューが空
    await chooseMenu(page, 'プレイリストに追加…');
    await page.click('#menuCancel');
    expect(player.sent('/AddToPlaylistOptions')[1]).toBe('/AddToPlaylistOptions?songid=%2Fm%2Ft.flac');

    await albumMenu.click();
    await chooseMenu(page, 'Go to artist');
    await expect(page.locator('#browse')).toContainText('Artist X page');
  });

  test('Amazon の曲・対象外のメニュー・取得失敗', async ({ page, player }) => {
    player.browse['TuneIn:'] = { item: [
      { text: 'Amazon Track', type: 'audio', contextMenuKey: 'Amazon:CM/Amazon-Item?addURL=%2Fcatalog%2Ftracks%2F42' },
      { text: 'Amazon Album', type: 'audio', contextMenuKey: 'Amazon:CM/Amazon-Item?addURL=%2Fcatalog%2Falbums%2F1' },
      { text: 'Amazon Folder', type: 'link', contextMenuKey: 'Amazon:CM/Amazon-Item?addURL=x' },
      { text: 'Song no file', contextMenuKey: 'LocalMusic:CM/LocalMusic-Song?x=1' },
      { text: 'Album no name', contextMenuKey: 'LocalMusic:CM/LocalMusic-Album?artist=X' },
      { text: 'Broken', contextMenuKey: 'broken' },
    ] };
    player.on('/Browse', (u) => (u.searchParams.get('key') === 'broken' ? fail('menu down') : { browse: {} }));
    await openBrowse(page);
    await page.locator('#browse').getByText('TuneIn').click();
    const menuOf = (text) => page.locator('#browse .row', { hasText: text }).locator('[title="メニュー"]');
    await menuOf('Amazon Track').click();
    await chooseMenu(page, 'プレイリストに追加…');
    await expect.poll(() => player.sent('/AddToPlaylistOptions')).toEqual(['/AddToPlaylistOptions?songid=Amazon%3A%2Fcatalog%2Ftracks%2F42']);
    await page.click('#menuCancel');
    for (const text of ['Amazon Album', 'Amazon Folder', 'Song no file', 'Album no name']) {
      await menuOf(text).click();
      await expect(page.locator('#menuItems')).toHaveText('操作はありません');
      await page.click('#menuCancel');
    }
    await menuOf('Broken').click();
    await expect(page.locator('#menuItems')).toHaveText('取得できません: menu down');
  });

  test('メニューの読み込み中に別のメニューを開いたら、古い結果で上書きしない', async ({ page, player }) => {
    player.browse['TuneIn:'] = { item: [{ text: 'Slow', contextMenuKey: 'slow' }, { text: 'Fast', contextMenuKey: 'fast' }] };
    let release;
    player.on('/Browse', async (u) => {
      if (u.searchParams.get('key') === 'slow') {
        await new Promise((r) => (release = r));
        return { browse: { item: [{ text: 'Slow action' }] } };
      }
      if (u.searchParams.get('key') === 'fast') return { browse: { item: [{ text: 'Fast action' }] } };
      return fail('slow failed');
    });
    await openBrowse(page);
    await page.locator('#browse').getByText('TuneIn').click();
    await page.locator('#browse .row', { hasText: 'Slow' }).locator('[title="メニュー"]').click();
    await expect.poll(() => typeof release).toBe('function');
    // 背景のクリックで閉じる
    await page.locator('#menu').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('#menu')).toBeHidden();
    await page.locator('#browse .row', { hasText: 'Fast' }).locator('[title="メニュー"]').click();
    await expect(page.locator('#menuItems')).toHaveText('Fast action');
    release();
    await page.waitForTimeout(200);
    await expect(page.locator('#menuItems')).toHaveText('Fast action');
    await expect(page.locator('#menuTitle')).toHaveText('Fast');
  });

  test('古いメニューの読み込み失敗も表示しない', async ({ page, player }) => {
    player.browse['TuneIn:'] = { item: [{ text: 'Slow', contextMenuKey: 'slow' }] };
    let release;
    player.on('/Browse', async () => { await new Promise((r) => (release = r)); return fail('slow failed'); });
    await openBrowse(page);
    await page.locator('#browse').getByText('TuneIn').click();
    await page.locator('#browse .row', { hasText: 'Slow' }).locator('[title="メニュー"]').click();
    await expect.poll(() => typeof release).toBe('function');
    await page.keyboard.press('Escape');
    await page.click('#btnSleep');
    release();
    await page.waitForTimeout(200);
    await expect(page.locator('#menuTitle')).toHaveText('スリープタイマー');
    await expect(page.locator('#menuItems button').first()).toHaveText('15 分');
  });
});
