import { expect, test } from '@playwright/test';

const identifier = process.env.PLAYWRIGHT_E2E_IDENTIFIER?.trim() ?? '';
const password = process.env.PLAYWRIGHT_E2E_PASSWORD?.trim() ?? '';
const deployedBaseURL = process.env.PLAYWRIGHT_DEPLOYED_BASE_URL?.trim() ?? '';

function assertDeployedE2EEnvReady(): void {
  const missing: string[] = [];
  if (!deployedBaseURL) {
    missing.push('PLAYWRIGHT_DEPLOYED_BASE_URL');
  }
  if (!identifier) {
    missing.push('PLAYWRIGHT_E2E_IDENTIFIER');
  }
  if (!password) {
    missing.push('PLAYWRIGHT_E2E_PASSWORD');
  }
  if (missing.length > 0) {
    throw new Error(`missing deployed e2e env: ${missing.join(', ')}`);
  }
}

test.describe('deployed core path smoke', () => {
  test('logs in and loads summary + kanban with real core APIs', async ({ page }) => {
    assertDeployedE2EEnvReady();
    await page.goto('/login');

    await page.getByPlaceholder('用户名或邮箱').fill(identifier);
    await page.getByPlaceholder('密码', { exact: true }).fill(password);

    const authMeResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'GET'
      && response.url().includes('/auth/me')
      && response.ok()
    ));
    const overviewResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'GET'
      && response.url().includes('/summary/overview')
      && response.ok()
    ));

    await page.getByRole('button', { name: '登录' }).click();

    await authMeResponsePromise;
    await overviewResponsePromise;
    await expect(page).toHaveURL(/\/summary$/);
    await expect(page.getByTestId('summary-page')).toBeVisible();

    const boardTasksResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'GET'
      && /\/api\/v1\/boards\/default\/tasks(\?|$)/.test(response.url())
      && response.ok()
    ));

    await page.goto('/kanban');

    await boardTasksResponsePromise;
    await expect(page).toHaveURL(/\/kanban$/);
    await expect(page.getByTestId('kanban-board')).toBeVisible();
  });
});
