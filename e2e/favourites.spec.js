// お気に入り
import { test, expect, expectToast, chooseMenu, fail } from './fixtures.js';

const SONGS = 'LocalMusic:Song/%2Flibrary%2Fv1%2FSongs%3Fcategory=FAVOURITES&service=LocalMusic';
const ALBUMS = 'LocalMusic:Album/%2Flibrary%2Fv1%2FAlbums%3Fcategory=FAVOURITES&service=LocalMusic';
const ARTISTS = 'LocalMusic:Artist/%2Flibrary%2Fv1%2FArtists%3Fcategory=FAVOURITES&service=LocalMusic';
const TUNEIN = 'TuneIn:BrowseMenu/%2FRadioBrowse%3Fservice=TuneIn&url=presets';

test('分類ごとに表示し、すべて再生・すべて表示・項目のメニューが使える', async ({ page, player }) => {
  player.browse[SONGS] = {
    playURL: '/Add?fav=1', nextKey: 'more',
    item: [{ text: 'Fav Song', playURL: '/Add?song=1', contextMenuKey: 'cm-song', duration: '125' }],
  };
  player.browse[ALBUMS] = { category: [{ text: 'A', item: [{ text: 'Fav Album', browseKey: 'album-1', tracks: '12' }] }] };
  player.browse[TUNEIN] = { item: [{ text: 'Jazz FM', browseKey: 'tunein-jazz', text2: 'Jazz' }] };
  player.browse['tunein-jazz'] = { item: [{ text: 'Jazz detail' }] };
  player.browse.more = { item: [] };
  player.menus['cm-song'] = { item: [{ text: 'お気に入りから削除', actionURL: '/DeleteFavourite?x=1' }] };
  player.on('/api/browse', (u) => (u.searchParams.get('key') === ARTISTS ? fail('artists down') : player.defaultResponse('/api/browse', u)));

  await page.goto('/');
  await page.click('[data-tab="favourites"]');
  await expect(page.locator('#favourites h3')).toHaveText(['曲（1+）', 'アルバム（1）', 'ラジオ局（TuneIn）（1）']);
  await expect(page.locator('#favourites')).toContainText('取得できません: artists down');
  await expect(page.locator('#favInfo')).toHaveText('3 件');
  await expect(page.locator('#favourites')).toContainText('2:05');
  await expect(page.locator('#favourites')).toContainText('12 曲');

  await page.locator('#favourites .section-head', { hasText: '曲（1+）' }).getByText('▶ すべて再生').click();
  await expectToast(page, 'お気に入りの曲を再生');
  await page.getByText('Fav Song').click();
  await expectToast(page, 'Fav Song を再生');

  // メニューの操作後はお気に入りを読み直す
  const before = player.sent(`/api/browse?key=${encodeURIComponent(SONGS)}`).length;
  await page.locator('#favourites .row', { hasText: 'Fav Song' }).locator('[title="メニュー"]').click();
  await chooseMenu(page, 'お気に入りから削除');
  await expect.poll(() => player.sent(`/api/browse?key=${encodeURIComponent(SONGS)}`).length).toBeGreaterThan(before);

  // TuneIn の項目は TuneIn の下として開く
  await page.getByText('Jazz FM').click();
  await expect(page.locator('#crumbs')).toHaveText('ソース › TuneIn › Jazz FM');
  await expect(page.locator('#browse')).toContainText('Jazz detail');

  // すべて表示は Library の下に開く
  await page.click('[data-tab="favourites"]');
  await page.getByText('すべて表示').click();
  await expect(page.locator('#crumbs')).toHaveText('ソース › Library › お気に入りの曲');
  await page.click('#btnBrowseBack');
  await expect(page.locator('#crumbs')).toHaveText('ソース › Library');
});

test('お気に入りが無い時の表示と再読み込み', async ({ page, player }) => {
  await page.goto('/');
  await page.click('[data-tab="favourites"]');
  await expect(page.locator('#favourites')).toHaveText('お気に入りはありません。曲のメニュー（⋯）や再生中の ♡ から追加できます');
  await expect(page.locator('#favInfo')).toHaveText('');
  const n = player.sent('/api/browse').length;
  await page.click('#btnFavReload');
  await expect.poll(() => player.sent('/api/browse').length).toBe(n + 5);
});

test('読み込み中にもう一度頼まれても同時には読み込まない', async ({ page, player }) => {
  let release;
  const gate = new Promise((r) => (release = r));
  player.on('/api/browse', async (u) => { await gate; return player.defaultResponse('/api/browse', u); });
  await page.goto('/');
  await page.click('[data-tab="favourites"]');
  await expect(page.locator('#favourites')).toHaveText('読み込み中…');
  await page.click('#btnFavReload');
  release();
  await expect(page.locator('#favourites')).toContainText('お気に入りはありません');
  expect(player.sent('/api/browse')).toHaveLength(5);
});
