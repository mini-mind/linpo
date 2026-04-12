import { expect, type Page, type Route, test } from '@playwright/test';

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

function overviewPayload() {
  return {
    request_id: 'req-flow-outoforder-local',
    freshness: {
      status: 'fresh',
      checked_at: nowIso(),
    },
    partial_failure: false,
    diagnostics: [],
    agents: [
      {
        instance_id: 'instance-local',
        instance_name: 'local-instance',
        agent_id: 'planner',
        agent_name: 'Planner Agent',
        status: 'idle',
        is_active: false,
        last_active_at: null,
        drilldown_path: '/session/planner/__none__/__new__?instanceId=instance-local',
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

function makeDraft(id: string, name: string, nodeTitle: string): FlowDraft {
  return {
    id,
    name,
    requirement: name,
    nodes: [
      {
        id: `${id}-node-1`,
        title: nodeTitle,
        description: null,
        depends_on: [],
        x: 160,
        y: 120,
        layer: 1,
        sensitive: false,
        status: 'queued',
        agent_id: null,
        instance_id: null,
      },
    ],
    edges: [],
    planner_messages: [],
    lanes: [],
    node_lane_by_id: {},
    planner_session_key: null,
    execution_session_prefix: null,
    executor_agent_id: null,
    revision: 1,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
}

async function fulfillJson(route: Route, payload: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  });
}

async function installOutOfOrderMocks(page: Page): Promise<void> {
  const drafts = new Map<string, FlowDraft>([
    ['draft_ooo_a', makeDraft('draft_ooo_a', '流程A-乱序', 'A-稳定节点')],
    ['draft_ooo_b', makeDraft('draft_ooo_b', '流程B-乱序', 'B-稳定节点')],
  ]);
  let delayedGenerateDone = false;

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const { pathname } = url;

    if (pathname === '/api/v1/auth/me' && method === 'GET') {
      await fulfillJson(route, {
        id: 'user-local',
        username: 'local-user',
        email: 'local@example.com',
      });
      return;
    }

    if (pathname === '/api/v1/summary/overview' && method === 'GET') {
      await fulfillJson(route, overviewPayload());
      return;
    }

    if (pathname === '/api/v1/instances' && method === 'GET') {
      await fulfillJson(route, [
        {
          id: 'instance-local',
          name: 'local-instance',
          type: 'openclaw',
          endpoint: 'http://localhost:8000',
          status: 'healthy',
          last_check_at: nowIso(),
          created_at: nowIso(),
        },
      ]);
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
      const id = typeof raw.id === 'string' ? raw.id : '';
      const current = drafts.get(id);
      if (!current) {
        await fulfillJson(route, { detail: 'draft not found' }, 404);
        return;
      }

      const next: FlowDraft = {
        ...current,
        nodes: Array.isArray(raw.nodes) ? (raw.nodes as Array<Record<string, unknown>>) : current.nodes,
        edges: Array.isArray(raw.edges) ? (raw.edges as Array<Record<string, unknown>>) : current.edges,
        planner_messages: Array.isArray(raw.plannerMessages)
          ? (raw.plannerMessages as Array<Record<string, unknown>>)
          : current.planner_messages,
        revision: current.revision + 1,
        updated_at: nowIso(),
      };
      drafts.set(id, next);
      await fulfillJson(route, next);
      return;
    }

    if (pathname === '/api/v1/boards/default/tasks/flow/generate' && method === 'POST') {
      const raw = (request.postDataJSON() as Record<string, unknown>) ?? {};
      const flowId = typeof raw.flowId === 'string' ? raw.flowId : '';
      if (flowId === 'draft_ooo_a' && !delayedGenerateDone) {
        delayedGenerateDone = true;
        await new Promise((resolve) => setTimeout(resolve, 900));
      }

      if (flowId === 'draft_ooo_a') {
        const current = drafts.get(flowId);
        if (current) {
          const generatedNode = {
            id: `${flowId}-node-generated`,
            title: 'A-延迟生成节点',
            description: 'from delayed generate',
            depends_on: [],
            x: 220,
            y: 180,
            layer: 1,
            sensitive: false,
            status: 'queued',
            agent_id: null,
            instance_id: null,
          };
          drafts.set(flowId, {
            ...current,
            nodes: [generatedNode],
            revision: current.revision + 1,
            updated_at: nowIso(),
          });
          await fulfillJson(route, {
            planner_session_key: `linpo:flow:default:planner:planner:${flowId}`,
            requirement: raw.requirement ?? current.requirement,
            nodes: [generatedNode],
            diagnostics: [],
            fallback_reason: null,
          });
          return;
        }
      }

      await fulfillJson(route, {
        planner_session_key: 'linpo:flow:default:planner:planner:noop',
        requirement: '',
        nodes: [],
        diagnostics: [],
        fallback_reason: null,
      });
      return;
    }

    await fulfillJson(route, {});
  });
}

test.describe('flow out-of-order session safety local', () => {
  test('late response from old flow does not override active flow UI', async ({ page }) => {
    await installOutOfOrderMocks(page);

    await page.goto('/flow/edit/draft_ooo_a');
    await expect(page.getByRole('button', { name: '流程节点-A-稳定节点' })).toBeVisible();

    const plannerInput = page.getByTestId('flow-planner-input');
    await expect(plannerInput).toBeVisible();
    await plannerInput.fill('为流程A生成一个节点');
    await plannerInput.press('Enter');

    const flowBCard = page.locator('[data-testid="flow-sidebar-card-draft_ooo_b"]').first();
    await flowBCard.getByRole('button', { name: '切换流程-流程B-乱序' }).click();
    await expect(page).toHaveURL(/\/flow\/edit\/draft_ooo_b$/);

    await expect(page.getByRole('button', { name: '流程节点-B-稳定节点' })).toBeVisible();
    await expect(page.getByRole('button', { name: '流程节点-A-延迟生成节点' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '流程节点-A-稳定节点' })).toHaveCount(0);
  });
});
