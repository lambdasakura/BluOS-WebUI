// 共通のフィクスチャ。player（API のモック）と、各テストのカバレッジ収集を用意する
import { test as base, expect } from '@playwright/test';
import MCR from 'monocart-coverage-reports';
import { MockPlayer } from './mock-player.js';
import { coverageOptions } from './coverage.js';

export { expect };
export { fail, raw, song } from './mock-player.js';

export const test = base.extend({
  // 最初のタブを固定する（前回のタブは localStorage に残る）
  storageState: { cookies: [], origins: [] },

  // 使わないテストでも必ずモックする（実機へ要求が漏れないように）
  player: [async ({ page }, use) => {
    // prompt / confirm には answerDialog で積んだ順に答える（無ければ取り消す）
    page.dialogAnswers = [];
    page.on('dialog', (d) => {
      const value = page.dialogAnswers.shift();
      return value == null ? d.dismiss() : d.accept(value);
    });
    const player = new MockPlayer(page);
    await player.install();
    await use(player);
  }, { auto: true }],

  coverage: [async ({ page }, use) => {
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    await use();
    const entries = await page.coverage.stopJSCoverage();
    await MCR(coverageOptions).add(entries.filter(coverageOptions.entryFilter));
  }, { auto: true }],
});

// トーストの表示を待つ
export async function expectToast(page, text) {
  await expect(page.locator('#toast')).toContainText(text);
}

// 次のダイアログ（prompt / confirm）への答えを順に積む。null は取り消し、'' は confirm の OK
export function answerDialog(page, ...values) {
  page.dialogAnswers.push(...(values.length ? values : ['']));
}

// メニュー（ボトムシート）の項目を押す
export async function chooseMenu(page, text) {
  await page.locator('#menuItems button', { hasText: text }).first().click();
}
