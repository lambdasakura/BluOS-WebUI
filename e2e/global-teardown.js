import MCR from 'monocart-coverage-reports';
import { coverageOptions, THRESHOLD } from './coverage.js';

const METRICS = { lines: '行', statements: '文', functions: '関数', branches: '分岐' };

// 各テストで集めたカバレッジをまとめてレポートを出し、下限に届かなければ失敗にする。
// 一部のテストだけ実行する時は COVERAGE_CHECK=0 で下限の確認を外す
export default async function globalTeardown() {
  const { summary } = (await MCR(coverageOptions).generate()) ?? {};
  if (process.env.COVERAGE_CHECK === '0') return;
  if (!summary) throw new Error('E2E のカバレッジを集計できませんでした');
  const low = Object.entries(METRICS)
    .filter(([key]) => !(summary[key]?.pct >= THRESHOLD))
    .map(([key, label]) => `${label} ${summary[key]?.pct}%`);
  if (low.length) throw new Error(`E2E のカバレッジが下限 ${THRESHOLD}% を下回っています: ${low.join(', ')}`);
}
