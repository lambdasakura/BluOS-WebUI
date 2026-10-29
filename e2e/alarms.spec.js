// アラーム
import { test, expect, expectToast, answerDialog, fail } from './fixtures.js';

const alarm = (extra) => ({
  id: '1', hour: '7', minute: '5', days: '0111110', duration: '60', source: 'Current play queue or station',
  volume: '20', fadein: '0', enable: '1', ...extra,
});
const rows = (page) => page.locator('#alarms .row');
const TZ = (page) => page.evaluate(() => encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone));
const params = (call) => Object.fromEntries(new URL(`http://x${call}`).searchParams);

test('時刻順に表示し、繰り返し・音源・自動停止・フェードを表示する', async ({ page, player }) => {
  player.alarms = [
    alarm({ id: '1', hour: '22', minute: '0', days: '1111111' }),
    alarm({ id: '2', hour: '6', minute: '30', days: '0000000', enable: '0', duration: '0', fadein: '1' }),
    alarm({ id: '3', hour: '7', minute: '0', days: '1000001', source: 'Morning', url: 'TuneIn:s1' }),
    alarm({ id: '4', hour: '8', minute: '0', days: '0101010' }),
    alarm({ id: '5', hour: '9', minute: '0' }),
    alarm({ id: '6', hour: '10', minute: '0', days: undefined }),
  ];
  await page.goto('/');
  await page.click('[data-tab="alarms"]');
  await expect(page.locator('#alarmInfo')).toHaveText('6 件');
  await expect(rows(page).locator('.alarm-time')).toHaveText(['06:30', '07:00', '08:00', '09:00', '10:00', '22:00']);
  await expect(rows(page).locator('.row-title')).toHaveText(['1 回のみ', '週末', '月水金', '平日', '1 回のみ', '毎日']);
  await expect(rows(page).nth(0)).toHaveClass(/off/);
  await expect(rows(page).nth(0).locator('.row-sub')).toHaveText('現在のキュー／局 • 音量 20 • 自動停止なし • フェードイン');
  await expect(rows(page).nth(1).locator('.row-sub')).toHaveText('Morning • 音量 20 • 60 分で停止');
  // タブを切り替えても読み直さない
  await page.click('[data-tab="queue"]');
  await page.click('[data-tab="alarms"]');
  expect(player.sent('/Alarms')).toHaveLength(1);
});

test('アラームが無い・取得失敗（次に開いた時に読み直す）', async ({ page, player }) => {
  player.on('/Alarms', () => fail('down'));
  await page.goto('/');
  await page.click('[data-tab="alarms"]');
  await expect(page.locator('#alarms')).toHaveText('取得できません: down');
  player.handlers.delete('/Alarms');
  await page.click('[data-tab="queue"]');
  await page.click('[data-tab="alarms"]');
  await expect(page.locator('#alarms')).toHaveText('アラームはありません');
  await expect(page.locator('#alarmInfo')).toHaveText('');
});

test('新しいアラームを追加する（プリセットを音源にする）', async ({ page, player }) => {
  await page.goto('/');
  await page.click('[data-tab="alarms"]');
  await page.click('#btnAlarmNew');
  await expect(page.locator('#alarmForm')).toBeVisible();
  await expect(page.locator('#btnAlarmNew')).toBeHidden();
  await expect(page.locator('#alarmTime')).toHaveValue('07:00');
  await expect(page.locator('#alarmSource option')).toHaveText(['現在のキュー／局', 'プリセット 1. Morning', 'プリセット 2. Chill', 'プリセット 3. TV']);
  await page.fill('#alarmTime', '06:45');
  await page.selectOption('#alarmSource', '1');
  await page.locator('#alarmVolume').fill('55');
  await expect(page.locator('#alarmVolumeValue')).toHaveText('55');
  await page.selectOption('#alarmDuration', '0');
  await page.check('#alarmFade');
  await page.locator('.days label', { hasText: '日' }).click();
  await page.click('#alarmForm button[type="submit"]');
  await expectToast(page, 'アラームを追加しました');
  await expect(page.locator('#alarmForm')).toBeHidden();
  const tz = await TZ(page);
  expect(player.sent('/Alarms?hour')).toEqual([
    `/Alarms?hour=6&minute=45&days=1111110&volume=55&duration=0&fadeIn=1&enable=1&source=Morning&url=TuneIn%3As1&image=%2Fp1.png&tz=${tz}`,
  ]);
});

test('既存のアラームを編集する（現在のキュー・プリセット・元の音源を保つ）', async ({ page, player }) => {
  player.alarms = [
    alarm({ id: '1' }),
    alarm({ id: '2', hour: '8', source: 'Chill', url: '/Load?name=Chill' }),
    alarm({ id: '3', hour: '9', source: 'Old Station', url: 'TuneIn:gone', image: '/old.png' }),
    alarm({ id: '4', hour: '10', source: 'Spotify thing' }),
  ];
  await page.goto('/');
  await page.click('[data-tab="presets"]'); // プリセットを読み込み済みにする
  await expect(page.locator('#presets .tile')).toHaveCount(3);
  await page.click('[data-tab="alarms"]');
  await rows(page).nth(0).locator('.row-main').click();
  await expect(page.locator('#alarmSource')).toHaveValue('');
  await expect(page.locator('.days input:checked')).toHaveCount(5);
  await page.click('#alarmForm button[type="submit"]');
  await expectToast(page, 'アラームを更新しました');

  await rows(page).nth(1).locator('.row-main').click();
  await expect(page.locator('#alarmSource')).toHaveValue('2');
  await page.click('#alarmCancel');
  await expect(page.locator('#alarmForm')).toBeHidden();

  await rows(page).nth(2).locator('.row-main').click();
  await expect(page.locator('#alarmSource option').first()).toHaveText('現在の設定（Old Station）');
  await expect(page.locator('#alarmSource')).toHaveValue('keep');
  await page.click('#alarmForm button[type="submit"]');

  await rows(page).nth(3).locator('.row-main').click();
  await expect(page.locator('#alarmSource option').first()).toHaveText('現在の設定（Spotify thing）');
  await page.click('#alarmForm button[type="submit"]');

  const saves = player.sent('/Alarms?hour').map(params);
  expect(saves[0]).toMatchObject({ id: '1', source: 'Current play queue or station' });
  expect(saves[0].url).toBeUndefined();
  expect(saves[1]).toMatchObject({ id: '3', source: 'Old Station', url: 'TuneIn:gone', image: '/old.png' });
  expect(saves[2]).toMatchObject({ id: '4', source: 'Spotify thing' });
  expect(saves[2].url).toBeUndefined();
});

test('プリセットを取得できなくても編集できる', async ({ page, player }) => {
  player.alarms = [alarm({ source: undefined })];
  player.on('/Presets', () => fail('x'));
  await page.goto('/');
  await page.click('[data-tab="alarms"]');
  await rows(page).nth(0).locator('.row-main').click();
  await expect(page.locator('#alarmSource option')).toHaveText(['現在のキュー／局']);
  await page.click('#alarmForm button[type="submit"]');
  expect(params(player.sent('/Alarms?hour')[0]).source).toBe('Current play queue or station');
});

test('有効・無効の切り替えは全項目を送る', async ({ page, player }) => {
  player.alarms = [alarm({ id: '1', fadein: '1', url: 'TuneIn:s1', source: 'Morning' }), alarm({ id: '2', hour: '8', enable: '0', days: undefined, source: undefined })];
  await page.goto('/');
  await page.click('[data-tab="alarms"]');
  await rows(page).nth(0).locator('.switch').click();
  await rows(page).nth(1).locator('.switch').click();
  await expect.poll(() => player.sent('/Alarms?id')).toHaveLength(2);
  const [off, on] = player.sent('/Alarms?id').map(params);
  expect(off).toMatchObject({ id: '1', hour: '7', minute: '5', days: '0111110', volume: '20', duration: '60', fadeIn: '1', enable: '0', source: 'Morning', url: 'TuneIn:s1', image: '' });
  expect(on).toMatchObject({ id: '2', days: '0000000', fadeIn: '0', enable: '1', source: 'Current play queue or station' });
  await expect(page.locator('#alarmForm')).toBeHidden(); // スイッチのクリックで編集を開かない
});

test('削除（確認あり）・応答に一覧が無ければ読み直す・失敗したらエラー', async ({ page, player }) => {
  player.alarms = [alarm()];
  await page.goto('/');
  await page.click('[data-tab="alarms"]');
  answerDialog(page, null);
  await rows(page).nth(0).locator('[title="削除"]').click();
  expect(player.sent('/Alarms?id')).toEqual([]);
  player.on('/Alarms', (u) => (u.searchParams.get('delete') ? {} : player.defaultResponse('/Alarms', u)));
  answerDialog(page);
  await rows(page).nth(0).locator('[title="削除"]').click();
  await expectToast(page, 'アラームを削除しました');
  expect(player.sent('/Alarms?id')).toEqual([`/Alarms?id=1&delete=1&tz=${await TZ(page)}`]);
  await expect.poll(() => player.sent('/Alarms?tz')).toHaveLength(2);

  player.on('/Alarms', (u) => (u.searchParams.get('delete') ? fail('locked') : player.defaultResponse('/Alarms', u)));
  answerDialog(page);
  await rows(page).nth(0).locator('[title="削除"]').click();
  await expectToast(page, 'エラー: locked');
  await expect.poll(() => player.sent('/Alarms?tz')).toHaveLength(3);
});
