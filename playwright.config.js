// E2E テストの設定。プレーヤーの API はすべて e2e/mock-player.js でモックする。
// BLUOS_HOST には到達しないアドレスを渡し、モック漏れがあっても実機には何も送らない
import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['junit', { outputFile: 'test-results/junit.xml' }]] : 'list',
  globalSetup: './e2e/global-setup.js',
  globalTeardown: './e2e/global-teardown.js',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node server.js',
    url: `http://127.0.0.1:${PORT}/api/config`,
    env: { BLUOS_HOST: '127.0.0.1:9', PORT: String(PORT), LISTEN: '127.0.0.1' },
    reuseExistingServer: false,
  },
});
