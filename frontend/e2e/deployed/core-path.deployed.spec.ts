import { expect, test } from '@playwright/test';

const deployedBaseURL = process.env.PLAYWRIGHT_DEPLOYED_BASE_URL?.trim() ?? '';

function assertDeployedE2EEnvReady(): void {
  const missing: string[] = [];
  if (!deployedBaseURL) {
    missing.push('PLAYWRIGHT_DEPLOYED_BASE_URL');
  }
  if (missing.length > 0) {
    throw new Error(`missing deployed e2e env: ${missing.join(', ')}`);
  }
}

test.describe('deployed core path smoke', () => {
  test('loads kanban + flow + files and summary overview API without login', async ({ page }) => {
    assertDeployedE2EEnvReady();

    const summaryOverviewResponse = await page.request.get('/api/v1/summary/overview');
    expect(summaryOverviewResponse.ok()).toBeTruthy();

    const boardTasksResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'GET'
      && /\/api\/v1\/boards\/default\/tasks(\?|$)/.test(response.url())
      && response.ok()
    ));

    await page.goto('/kanban');

    await boardTasksResponsePromise;
    await expect(page).toHaveURL(/\/kanban$/);
    await expect(page.getByTestId('kanban-board')).toBeVisible();

    await page.goto('/flow');
    await expect(page).toHaveURL(/\/flow\/edit\/.+$/);
    await expect(page.getByTestId('flow-planner-shell')).toBeVisible();

    await page.goto('/files');
    await expect(page).toHaveURL(/\/files$/);
    await expect(page.getByTestId('instance-files-shell')).toBeVisible();
  });
});
