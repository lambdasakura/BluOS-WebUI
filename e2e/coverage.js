// E2E のカバレッジ（ブラウザで動く public/app.js が対象）。Chromium の V8 カバレッジを集計する
export const THRESHOLD = 95; // 行・文・関数・分岐それぞれの下限（%）

export const coverageOptions = {
  name: 'E2E coverage (public/app.js)',
  outputDir: './coverage/e2e',
  reports: ['console-summary', 'lcovonly', 'v8'],
  entryFilter: (entry) => new URL(entry.url).pathname === '/app.js',
  sourcePath: (path) => path.replace(/^[^/]+\//, 'public/'), // 127.0.0.1-3100/app.js → public/app.js
};
