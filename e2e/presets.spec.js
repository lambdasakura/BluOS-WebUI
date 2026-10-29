// プリセット・入力
import { test, expect, expectToast, answerDialog, fail } from './fixtures.js';

const tiles = (page) => page.locator('#presets .tile');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('プリセットと入力を表示し、再生・入力切り替え・現在の強調', async ({ page, player }) => {
  player.status.prid = '1';
  player.status.inputId = 'input1';
  player.setStatus({});
  await page.click('[data-tab="presets"]');
  await expect(tiles(page)).toHaveText(['1. Morning', '2. Chill', '3. TV']);
  await expect(tiles(page).nth(0)).toHaveClass(/current/);
  await expect(page.locator('#inputs .tile')).toHaveText(['Optical', 'HDMI']);
  await expect(page.locator('#inputs .tile').nth(1)).toHaveClass(/current/);
  await tiles(page).nth(1).click();
  await expectToast(page, 'Chill を再生');
  await page.locator('#inputs .tile').nth(0).click();
  await expectToast(page, 'Optical に切り替え');
  expect(player.calls).toEqual(expect.arrayContaining(['/Preset?id=2', '/Play?url=Capture%3Aspdif']));
  // タブを切り替えても読み直さない
  await page.click('[data-tab="queue"]');
  await page.click('[data-tab="presets"]');
  expect(player.sent('/Presets')).toHaveLength(1);
});

test('編集モードで名前変更・削除・並べ替え・入力の追加', async ({ page, player }) => {
  await page.click('[data-tab="presets"]');
  await page.click('#btnPresetEdit');
  await expect(page.locator('#btnPresetEdit')).toHaveText('完了');
  await expect(page.locator('#tab-presets')).toHaveClass(/editing/);
  // 編集中のクリックは名前変更
  answerDialog(page, 'Wake up');
  await tiles(page).nth(0).click();
  await expectToast(page, '名前を変更しました');
  const wraps = page.locator('#presets .tile-wrap');
  answerDialog(page, 'Chill'); // 同じ名前なら何もしない
  await wraps.nth(1).locator('[title="名前を変更"]').click();
  answerDialog(page, null);
  await wraps.nth(1).locator('[title="名前を変更"]').click();
  // 先頭の「前へ」・末尾の「次へ」は押せない
  await expect(wraps.nth(0).locator('[title="前へ"]')).toBeDisabled();
  await expect(wraps.nth(2).locator('[title="次へ"]')).toBeDisabled();
  await wraps.nth(0).locator('[title="次へ"]').click();
  await wraps.nth(2).locator('[title="前へ"]').click();
  answerDialog(page, null);
  await wraps.nth(2).locator('[title="削除"]').click();
  answerDialog(page);
  await wraps.nth(2).locator('[title="削除"]').click();
  await expectToast(page, '「TV」を削除しました');
  await page.locator('#inputs .tile-wrap').nth(1).getByText('＋ プリセットに追加').click();
  await expectToast(page, '「HDMI」をプリセットに追加しました');
  await expect.poll(() => player.sent('/SetPreset')).toEqual([
    '/SetPreset?id=1&name=Wake+up&url=TuneIn%3As1&image=%2Fp1.png',
    '/SetPreset?id=1&name=Chill&url=%2FLoad%3Fname%3DChill',
    '/SetPreset?id=2&name=Morning&url=TuneIn%3As1&image=%2Fp1.png',
    '/SetPreset?id=3&name=Chill&url=%2FLoad%3Fname%3DChill',
    '/SetPreset?id=2&name=TV&url=Capture%3Ahdmi&image=%2Fp3.png',
    '/SetPreset?id=3',
    '/SetPreset?name=HDMI&url=Capture%3Ahdmi&image=%2Fi1.png',
  ]);
  await page.click('#btnPresetEdit');
  await expect(page.locator('#btnPresetEdit')).toHaveText('編集');
});

test('応答に一覧が無ければ読み直す。失敗したらエラーを出して読み直す', async ({ page, player }) => {
  await page.click('[data-tab="presets"]');
  await expect(tiles(page)).toHaveCount(3);
  await page.click('#btnPresetEdit');
  player.on('/SetPreset', () => ({}));
  answerDialog(page);
  await page.locator('#presets .tile-wrap').nth(0).locator('[title="削除"]').click();
  await expect.poll(() => player.sent('/Presets')).toHaveLength(2);
  player.on('/SetPreset', () => fail('full'));
  answerDialog(page);
  await page.locator('#presets .tile-wrap').nth(0).locator('[title="削除"]').click();
  await expectToast(page, 'エラー: full');
  await expect.poll(() => player.sent('/Presets')).toHaveLength(3);
});

test('プリセットが空・取得失敗', async ({ page, player }) => {
  player.presets = [];
  player.on('/RadioBrowse', () => ({ radiotime: {} }));
  await page.click('[data-tab="presets"]');
  await expect(page.locator('#presets')).toHaveText('プリセットはありません');
  await expect(page.locator('#inputs .tile')).toHaveCount(0);
});

test('取得に失敗したら次に開いた時に読み直す', async ({ page, player }) => {
  player.on('/Presets', () => fail('down'));
  await page.click('[data-tab="presets"]');
  await expect(page.locator('#presets')).toHaveText('取得できません: down');
  await expect(page.locator('#inputs .tile')).toHaveCount(2);
  player.handlers.delete('/Presets');
  await page.click('[data-tab="queue"]');
  await page.click('[data-tab="presets"]');
  await expect(tiles(page)).toHaveCount(3);
});
