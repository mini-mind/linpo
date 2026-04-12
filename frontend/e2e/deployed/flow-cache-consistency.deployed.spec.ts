import { expect, type Route, test } from '@playwright/test';

const deployedBaseURL = process.env.PLAYWRIGHT_DEPLOYED_BASE_URL?.trim() ?? '';

function assertDeployedE2EEnvReady(): void {
  if (!deployedBaseURL) {
    throw new Error('missing deployed e2e env: PLAYWRIGHT_DEPLOYED_BASE_URL');
  }
}

async function fulfillJson(route: Route, payload: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  });
}

test.describe('deployed flow cache consistency', () => {
  test('keeps flow route stable across multi-round refresh + route switching', async ({ page }) => {
    assertDeployedE2EEnvReady();

    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const method = request.method();
      const url = new URL(request.url());
      const { pathname } = url;

      if (pathname === '/api/v1/auth/me' && method === 'GET') {
        await fulfillJson(route, {
          id: 'user-deployed-e2e',
          username: 'deployed-e2e',
          email: 'deployed-e2e@example.com',
        });
        return;
      }
      if (pathname === '/api/v1/summary/overview' && method === 'GET') {
        await fulfillJson(route, {
          request_id: 'req-deployed-flow-cache',
          freshness: { status: 'fresh', checked_at: '2026-04-10T10:00:00Z' },
          partial_failure: false,
          diagnostics: [],
          agents: [],
          stats: {
            instance_count: 1,
            agent_count: 0,
            active_agent_count: 0,
            attention_instance_count: 0,
            total_tokens: 0,
          },
          token_groups: [],
          global_events: [],
        });
        return;
      }
      if (pathname === '/api/v1/instances' && method === 'GET') {
        await fulfillJson(route, []);
        return;
      }
      if (pathname === '/api/v1/boards/default/tasks' && method === 'GET') {
        await fulfillJson(route, []);
        return;
      }
      if (pathname === '/api/v1/boards/default/tasks/flow/drafts' && method === 'GET') {
        await fulfillJson(route, []);
        return;
      }
      await fulfillJson(route, {});
    });

    await page.goto('/flow');
    await expect(page).toHaveURL(/\/flow\/edit\/.+$/);
    await expect(page.getByTestId('flow-planner-shell')).toBeVisible();

    const stableFlowUrl = page.url();

    for (let round = 1; round <= 3; round += 1) {
      const boardTasksResponsePromise = page.waitForResponse((response) => (
        response.request().method() === 'GET'
        && /\/api\/v1\/boards\/default\/tasks(\?|$)/.test(response.url())
      ));

      await page.goto('/kanban');
      await boardTasksResponsePromise;
      await expect(page.getByTestId('kanban-board')).toBeVisible();

      await page.goto(stableFlowUrl);
      await expect(page).toHaveURL(stableFlowUrl);
      await expect(page.getByTestId('flow-planner-shell')).toBeVisible();

      await page.reload();
      await expect(page).toHaveURL(stableFlowUrl);
      await expect(page.getByTestId('flow-planner-shell')).toBeVisible();
    }
  });
});
