import { expect, type Route, test } from '@playwright/test';

const deployedBaseURL = process.env.PLAYWRIGHT_DEPLOYED_BASE_URL?.trim() ?? '';

function assertDeployedE2EEnvReady(): void {
  if (!deployedBaseURL) {
    throw new Error('missing deployed e2e env: PLAYWRIGHT_DEPLOYED_BASE_URL');
  }
}

function currentDraftIdFromUrl(url: string): string | null {
  const match = url.match(/\/flow\/edit\/([^/?#]+)/);
  return match?.[1] ?? null;
}

type FlowDraft = {
  id: string;
  name: string;
  requirement: string;
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  planner_messages: Array<Record<string, unknown>>;
  lanes: Array<Record<string, unknown>>;
  node_lane_by_id: Record<string, string>;
  planner_session_key: string | null;
  execution_session_prefix: string | null;
  executor_agent_id: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
};

function nowIso(): string {
  return '2026-04-10T10:00:00Z';
}

async function fulfillJson(route: Route, payload: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  });
}

async function installApiMocks(page: Parameters<typeof test>[0]['page']): Promise<void> {
  const drafts = new Map<string, FlowDraft>();

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
        request_id: 'req-deployed-flow-multiround',
        freshness: { status: 'fresh', checked_at: nowIso() },
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
      await fulfillJson(route, Array.from(drafts.values()));
      return;
    }

    if (pathname === '/api/v1/boards/default/tasks/flow/drafts' && method === 'POST') {
      const raw = (request.postDataJSON() as Record<string, unknown>) ?? {};
      const id =
        typeof raw.id === 'string' && raw.id.trim()
          ? raw.id
          : `draft_${Math.random().toString(36).slice(2, 10)}`;
      const current = drafts.get(id);
      const next: FlowDraft = {
        id,
        name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : `流程-${id.slice(0, 6)}`,
        requirement: typeof raw.requirement === 'string' ? raw.requirement : '',
        nodes: Array.isArray(raw.nodes) ? (raw.nodes as Array<Record<string, unknown>>) : current?.nodes ?? [],
        edges: Array.isArray(raw.edges) ? (raw.edges as Array<Record<string, unknown>>) : current?.edges ?? [],
        planner_messages: Array.isArray(raw.planner_messages)
          ? (raw.planner_messages as Array<Record<string, unknown>>)
          : current?.planner_messages ?? [],
        lanes: Array.isArray(raw.lanes) ? (raw.lanes as Array<Record<string, unknown>>) : current?.lanes ?? [],
        node_lane_by_id:
          raw.node_lane_by_id && typeof raw.node_lane_by_id === 'object'
            ? (raw.node_lane_by_id as Record<string, string>)
            : current?.node_lane_by_id ?? {},
        planner_session_key:
          typeof raw.planner_session_key === 'string' ? raw.planner_session_key : current?.planner_session_key ?? null,
        execution_session_prefix:
          typeof raw.execution_session_prefix === 'string'
            ? raw.execution_session_prefix
            : current?.execution_session_prefix ?? null,
        executor_agent_id:
          typeof raw.executor_agent_id === 'string' ? raw.executor_agent_id : current?.executor_agent_id ?? null,
        revision: current ? current.revision + 1 : 0,
        created_at: current?.created_at ?? nowIso(),
        updated_at: nowIso(),
      };
      drafts.set(id, next);
      await fulfillJson(route, next);
      return;
    }

    await fulfillJson(route, {});
  });
}

test.describe('deployed flow multi-round consistency', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('keeps flow draft state consistent across navigation and reload in 3 rounds', async ({ page }) => {
    assertDeployedE2EEnvReady();
    await installApiMocks(page);

    await page.goto('/flow');
    await expect(page).toHaveURL(/\/flow\/edit\/.+$/);

    if (page.url().endsWith('/flow/edit/new')) {
      await page.getByRole('button', { name: '创建流程' }).click();
      const createFlowDialog = page.getByRole('dialog', { name: '新建流程' });
      await expect(createFlowDialog).toBeVisible();
      await createFlowDialog.getByRole('textbox', { name: '流程名称' }).fill('Playwright 多轮次一致性');
      await createFlowDialog.getByRole('button', { name: '创建' }).click();
      await expect(page).toHaveURL(/\/flow\/edit\/draft_/);
    }

    const draftId = currentDraftIdFromUrl(page.url());
    expect(draftId).toBeTruthy();

    const runRound = async (index: number): Promise<void> => {
      const nodeTitle = `E2E轮次节点-${index}`;
      await page.getByRole('button', { name: '新建节点' }).click();
      await expect(page.getByRole('dialog', { name: '创建节点' })).toBeVisible();
      await page.getByPlaceholder('输入节点标题').fill(nodeTitle);
      await page.getByRole('button', { name: '保存节点' }).click();
      await expect(page.getByRole('button', { name: `流程节点-${nodeTitle}` })).toBeVisible();

      await page.goto('/kanban');
      await expect(page).toHaveURL(/\/kanban$/);
      await page.goto(`/flow/edit/${draftId}`);
      await expect(page.getByRole('button', { name: `流程节点-${nodeTitle}` })).toBeVisible();

      await page.reload();
      await expect(page.getByRole('button', { name: `流程节点-${nodeTitle}` })).toBeVisible();

      await expect(page.getByRole('button', { name: `流程节点-${nodeTitle}` })).toBeVisible();
    };

    await runRound(1);
    await runRound(2);
    await runRound(3);
  });
});
