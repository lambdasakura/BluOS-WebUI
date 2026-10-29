import MCR from 'monocart-coverage-reports';
import { coverageOptions } from './coverage.js';

// 前回の実行で溜まったカバレッジを消す
export default async function globalSetup() {
  MCR(coverageOptions).cleanCache();
}
