import { defineConfig } from '@playwright/test';

const localBaseURL = process.env.PLAYWRIGHT_LOCAL_BASE_URL ?? 'http://127.0.0.1:5173';
const deployedBaseURL = process.env.PLAYWRIGHT_DEPLOYED_BASE_URL ?? '';
const shouldStartLocalWebServer = process.env.PLAYWRIGHT_SKIP_LOCAL_WEB_SERVER !== '1';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  // 明确分层：local 只跑本地 mock e2e；deployed 只跑联调链路。
  projects: [
    {
      name: 'local',
      testMatch: /local\/.*\.spec\.ts$/,
      use: {
        baseURL: localBaseURL,
      },
    },
    {
      name: 'deployed',
      testMatch: /deployed\/.*\.spec\.ts$/,
      use: {
        baseURL: deployedBaseURL,
      },
    },
  ],
  // local e2e 允许开箱即跑；deployed 通过 PLAYWRIGHT_SKIP_LOCAL_WEB_SERVER=1 关闭本地服务启动。
  webServer: shouldStartLocalWebServer
    ? {
        command: 'npm run dev',
        url: localBaseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      }
    : undefined,
});
