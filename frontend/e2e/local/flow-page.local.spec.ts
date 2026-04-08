import { expect, type Route, test } from '@playwright/test';

function overviewPayload() {
  return {
    request_id: 'req-flow-smoke',
    freshness: {
      status: 'fresh',
      checked_at: '2026-04-02T00:00:00Z',
    },
    partial_failure: false,
    diagnostics: [],
    agents: [
      {
        instance_id: 'instance-smoke',
        instance_name: 'smoke-instance',
        agent_id: 'planner',
        agent_name: 'Planner Agent',
        status: 'idle',
        is_active: false,
        last_active_at: null,
        drilldown_path: '/session/planner/__none__/__new__?instanceId=instance-smoke',
      },
    ],
    stats: {
      instance_count: 1,
      agent_count: 1,
      active_agent_count: 0,
      attention_instance_count: 0,
      total_tokens: 0,
    },
    token_groups: [],
    global_events: [],
  };
}

async function fulfillJson(route: Route, payload: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  });
}

test.describe('flow page smoke', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('opens flow page and supports basic node creation path', async ({ page }) => {
    await page.route('**/auth/me**', async (route) => {
      await fulfillJson(route, {
        id: 'user-smoke',
        username: 'smoke-user',
        email: 'smoke@example.com',
      });
    });

    await page.route('**/summary/overview**', async (route) => {
      await fulfillJson(route, overviewPayload());
    });

    await page.route('**/api/v1/boards/default/tasks**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await fulfillJson(route, []);
    });

    await page.goto('/flow');
    await expect(page).toHaveURL(/\/flow\/edit\/new$/);

    const createFlowButton = page.getByRole('button', { name: '创建流程' });
    await expect(createFlowButton).toBeVisible();
    await expect(createFlowButton).toBeEnabled();
    await createFlowButton.click();
    const createFlowDialog = page.getByRole('dialog', { name: '新建流程' });
    await expect(createFlowDialog).toBeVisible();
    await createFlowDialog.getByRole('button', { name: '创建' }).click();
    await expect(page).toHaveURL(/\/flow\/edit\/draft_/);

    await expect(page.getByTestId('flow-canvas-viewport')).toBeVisible();

    const createNodeButton = page.getByRole('button', { name: '新建节点' });
    await expect(createNodeButton).toBeVisible();
    await expect(createNodeButton).toBeEnabled();
    await createNodeButton.click();

    const createDialog = page.getByRole('dialog', { name: '创建节点' });
    await expect(createDialog).toBeVisible();
    await page.getByPlaceholder('输入节点标题').fill('Smoke 节点');
    await page.getByRole('button', { name: '保存节点' }).click();

    await expect(page.getByRole('button', { name: '流程节点-Smoke 节点' })).toBeVisible();
  });
});
