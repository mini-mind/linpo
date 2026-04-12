import { expect, type Page, type Route, test } from '@playwright/test';

type DraftRecord = {
  id: string;
  name: string;
  requirement: string;
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  lanes: Array<Record<string, unknown>>;
  node_lane_by_id: Record<string, string>;
  planner_messages: Array<Record<string, unknown>>;
  planner_session_key: string | null;
  execution_session_prefix: string | null;
  executor_agent_id: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
};

type TaskRecord = {
  id: string;
  board_id: 'default';
  title: string;
  summary: string;
  status: 'queued' | 'running' | 'blocked_by_approval' | 'completed' | 'failed';
  source: 'flow';
  agent_id: string;
  agent_name: string;
  artifacts: string[];
  extras: Record<string, string>;
  instance_id: string;
  created_at: string;
  updated_at: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

async function fulfillJson(route: Route, payload: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  });
}

async function installFlowMockServer(page: Page): Promise<{
  calls: Record<string, number>;
  seedDrafts: (drafts: DraftRecord[]) => void;
}> {
  const calls: Record<string, number> = {
    rename: 0,
    stop: 0,
    cont: 0,
    deleteRequirement: 0,
    confirm: 0,
    generate: 0,
  };

  const draftsById = new Map<string, DraftRecord>();
  const tasks: TaskRecord[] = [];
  let upsertConflictDraftId: string | null = null;

  const seedDrafts = (drafts: DraftRecord[]): void => {
    draftsById.clear();
    for (const draft of drafts) {
      draftsById.set(draft.id, { ...draft });
    }
  };

  await page.route('**/auth/me**', async (route) => {
    await fulfillJson(route, {
      id: 'user-e2e',
      username: 'e2e-user',
      email: 'e2e@example.com',
    });
  });

  await page.route('**/summary/overview**', async (route) => {
    await fulfillJson(route, {
      request_id: 'req-e2e',
      freshness: { status: 'fresh', checked_at: nowIso() },
      partial_failure: false,
      diagnostics: [],
      agents: [
        {
          instance_id: 'instance-e2e',
          instance_name: 'instance-e2e',
          agent_id: 'planner',
          agent_name: 'Planner Agent',
          status: 'idle',
          is_active: false,
          last_active_at: null,
          drilldown_path: '/session/planner/__none__/__new__?instanceId=instance-e2e',
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
    });
  });

  await page.route('**/api/v1/instances**', async (route) => {
    await fulfillJson(route, [
      {
        id: 'instance-e2e',
        name: 'instance-e2e',
        type: 'openclaw',
        endpoint: 'http://127.0.0.1:8000',
        status: 'healthy',
        last_check_at: nowIso(),
        created_at: nowIso(),
      },
    ]);
  });

  await page.route('**/api/v1/boards/default/tasks/flow/planner-sessions/**/exists**', async (route) => {
    await fulfillJson(route, { exists: true });
  });

  await page.route('**/api/v1/sse/boards/default/tasks**', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      },
      body: '',
    });
  });

  await page.route('**/api/v1/boards/default/tasks/flow/planner-sse**', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      },
      body: '',
    });
  });

  await page.route('**/api/v1/boards/default/tasks/flow/planner-stop**', async (route) => {
    await fulfillJson(route, {
      session_key: 'planner-session-stopped',
      status: 'stopped',
      revision: 1,
      updated_at: nowIso(),
    });
  });

  await page.route('**/api/v1/boards/default/tasks**', async (route) => {
    const req = route.request();
    if (req.method() !== 'GET') {
      await route.continue();
      return;
    }
    await fulfillJson(route, tasks);
  });

  await page.route('**/api/v1/boards/default/tasks/flow/drafts**', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') {
      await fulfillJson(route, Array.from(draftsById.values()));
      return;
    }
    if (req.method() === 'POST') {
      const payload = req.postDataJSON() as Record<string, unknown>;
      const id = String(payload.id ?? '').trim();
      if (!id) {
        await fulfillJson(route, { detail: 'missing draft id' }, 422);
        return;
      }
      if (upsertConflictDraftId === id) {
        upsertConflictDraftId = null;
        await fulfillJson(route, { detail: 'draft conflict' }, 409);
        return;
      }
      const existing = draftsById.get(id);
      const revision = existing ? existing.revision + 1 : Number(payload.revision ?? 0);
      const nextDraft: DraftRecord = {
        id,
        name: String(payload.name ?? '未命名流程'),
        requirement: String(payload.requirement ?? ''),
        nodes: Array.isArray(payload.nodes) ? (payload.nodes as Array<Record<string, unknown>>) : [],
        edges: Array.isArray(payload.edges) ? (payload.edges as Array<Record<string, unknown>>) : [],
        lanes: Array.isArray(payload.lanes) ? (payload.lanes as Array<Record<string, unknown>>) : [],
        node_lane_by_id: (payload.node_lane_by_id as Record<string, string>) ?? {},
        planner_messages: Array.isArray(payload.planner_messages) ? (payload.planner_messages as Array<Record<string, unknown>>) : [],
        planner_session_key: (payload.planner_session_key as string | null) ?? null,
        execution_session_prefix: (payload.execution_session_prefix as string | null) ?? null,
        executor_agent_id: (payload.executor_agent_id as string | null) ?? null,
        revision,
        created_at: existing?.created_at ?? nowIso(),
        updated_at: nowIso(),
      };
      draftsById.set(id, nextDraft);
      await fulfillJson(route, nextDraft);
      return;
    }
    await route.continue();
  });

  await page.route('**/api/v1/boards/default/tasks/flow/drafts/**', async (route) => {
    const req = route.request();
    if (req.method() !== 'DELETE') {
      await route.continue();
      return;
    }
    const flowId = decodeURIComponent(req.url().split('/flow/drafts/')[1].split('?')[0]);
    draftsById.delete(flowId);
    await fulfillJson(route, { deleted: true, flow_id: flowId });
  });

  await page.route('**/api/v1/boards/default/tasks/flow/generate**', async (route) => {
    calls.generate += 1;
    const req = route.request();
    const payload = req.postDataJSON() as Record<string, unknown>;
    const requirement = String(payload.requirement ?? '');
    const draftNodes = (Array.isArray(payload.current_nodes) ? payload.current_nodes : []) as Array<Record<string, unknown>>;

    // Force deterministic out-of-order responses:
    // first request is slow, later requests are immediate.
    if (calls.generate === 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 1500));
    }

    const generatedNodeTitle = calls.generate === 1 ? '旧会话节点' : '新会话节点';
    await fulfillJson(route, {
      board_id: 'default',
      planner_session_key: `planner-session-${Math.max(calls.generate, 1)}`,
      manager_session_key: 'manager-session-e2e',
      execution_session_prefix: 'exec-e2e',
      nodes: [
        ...draftNodes,
        {
          id: `node_gen_${calls.generate}`,
          title: generatedNodeTitle,
          description: requirement,
          depends_on: [],
          x: 180,
          y: 180,
          layer: 0,
          sensitive: false,
          status: 'queued',
          agent_id: 'planner',
          instance_id: 'instance-e2e',
        },
      ],
      edges: [],
      messages: [
        { role: 'assistant', content: `已规划：${generatedNodeTitle}`, created_at: nowIso() },
      ],
      created_task_ids: [],
    });
  });

  await page.route('**/api/v1/boards/default/tasks/flow/confirm**', async (route) => {
    calls.confirm += 1;
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    const nodes = (Array.isArray(payload.nodes) ? payload.nodes : []) as Array<Record<string, unknown>>;
    const requirementTitle = String(payload.requirement ?? 'Flow E2E Requirement');
    const requirementId = 'req-flow-e2e';

    tasks.length = 0;
    nodes.forEach((node, index) => {
      const nodeId = String(node.id ?? `node_${index + 1}`);
      const status = index === 0 ? 'running' : 'queued';
      tasks.push({
        id: `task-${nodeId}`,
        board_id: 'default',
        title: String(node.title ?? nodeId),
        summary: String(node.description ?? 'mock summary'),
        status,
        source: 'flow',
        agent_id: 'planner',
        agent_name: 'Planner Agent',
        artifacts: [],
        extras: {
          requirement_id: requirementId,
          requirement_title: requirementTitle,
          flow_node: nodeId,
          dependencies: Array.isArray(node.depends_on) ? (node.depends_on as string[]).join(',') || 'none' : 'none',
          sensitive: 'false',
        },
        instance_id: 'instance-e2e',
        created_at: nowIso(),
        updated_at: nowIso(),
      });
    });

    await fulfillJson(route, {
      board_id: 'default',
      planner_session_key: String(payload.planner_session_key ?? 'planner-session-confirm'),
      manager_session_key: String(payload.manager_session_key ?? 'manager-session-confirm'),
      execution_session_prefix: String(payload.execution_session_prefix ?? 'exec-confirm'),
      nodes,
      edges: Array.isArray(payload.edges) ? payload.edges : [],
      messages: Array.isArray(payload.messages) ? payload.messages : [],
      created_task_ids: tasks.map((item) => item.id),
      dispatched_task_ids: tasks.length > 0 ? [tasks[0].id] : [],
    });
  });

  await page.route('**/api/v1/boards/default/tasks/requirements/**/rename**', async (route) => {
    calls.rename += 1;
    const payload = route.request().postDataJSON() as { name?: string };
    const nextName = String(payload.name ?? '').trim() || '未命名流程';
    for (const task of tasks) {
      task.extras.requirement_title = nextName;
      task.updated_at = nowIso();
    }
    await fulfillJson(route, {
      requirement_id: 'req-flow-e2e',
      requirement_title: nextName,
      updated_task_ids: tasks.map((item) => item.id),
    });
  });

  await page.route('**/api/v1/boards/default/tasks/requirements/**/stop**', async (route) => {
    calls.stop += 1;
    const runningIds: string[] = [];
    for (const task of tasks) {
      if (task.status === 'running') {
        runningIds.push(task.id);
      }
      task.status = 'blocked_by_approval';
      task.extras.dispatch_status = 'interrupted';
      task.updated_at = nowIso();
    }
    await fulfillJson(route, {
      requirement_id: 'req-flow-e2e',
      stopped_task_ids: tasks.map((item) => item.id),
      running_task_ids: runningIds,
    });
  });

  await page.route('**/api/v1/boards/default/tasks/requirements/**/continue**', async (route) => {
    calls.cont += 1;
    const resumed: string[] = [];
    for (const task of tasks) {
      if (task.status === 'blocked_by_approval') {
        task.status = resumed.length === 0 ? 'running' : 'queued';
        resumed.push(task.id);
      }
      delete task.extras.dispatch_status;
      task.updated_at = nowIso();
    }
    await fulfillJson(route, {
      requirement_id: 'req-flow-e2e',
      resumed_task_ids: resumed,
      dispatched_task_ids: resumed.length > 0 ? [resumed[0]] : [],
    });
  });

  await page.route('**/api/v1/boards/default/tasks/requirements/**', async (route) => {
    if (route.request().method() !== 'DELETE') {
      await route.continue();
      return;
    }
    calls.deleteRequirement += 1;
    tasks.length = 0;
    await fulfillJson(route, {
      deleted: true,
      deleted_task_ids: [],
      requirement_id: 'req-flow-e2e',
    });
  });

  await page.exposeFunction('e2eSetUpsertConflictDraftId', (draftId: string) => {
    upsertConflictDraftId = draftId;
  });

  return {
    calls,
    seedDrafts,
  };
}

async function createFlowAndNode(page: Page, nodeTitle: string): Promise<string> {
  await page.getByRole('button', { name: '创建流程' }).click();
  await page.getByRole('dialog', { name: '新建流程' }).getByRole('button', { name: '创建' }).click();
  await expect(page).toHaveURL(/\/flow\/edit\/draft_/);

  await expect(page.getByTestId('flow-canvas-viewport')).toBeVisible();
  await page.getByRole('button', { name: '新建节点' }).click();
  const createNodeDialog = page.getByRole('dialog', { name: '创建节点' });
  await createNodeDialog.getByPlaceholder('输入节点标题').fill(nodeTitle);
  await createNodeDialog.getByRole('button', { name: '保存节点' }).click();
  await expect(createNodeDialog).toHaveCount(0);

  const match = page.url().match(/\/flow\/edit\/(draft_[^/?#]+)/);
  if (!match) {
    throw new Error(`unexpected flow url: ${page.url()}`);
  }
  return decodeURIComponent(match[1]);
}

async function openFlowSidebarDrawer(page: Page): Promise<void> {
  const opener = page.getByRole('button', { name: '流程列表' });
  await expect(opener).toBeVisible();
  await opener.click({ force: true });
  await expect(page.getByRole('dialog', { name: '流程列表抽屉' })).toBeVisible();
}

async function closeFlowSidebarDrawer(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: '流程列表抽屉' });
  if (await dialog.count()) {
    const closeButton = dialog.getByRole('button', { name: '关闭' });
    if (await closeButton.count()) {
      await closeButton.first().click({ force: true });
    } else {
      await page.keyboard.press('Escape');
    }
    await expect(dialog).toHaveCount(0);
  }
}

test.describe('flow page full local e2e', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('covers confirm from frontend context with stable mock flow', async ({ page }) => {
    const { calls } = await installFlowMockServer(page);

    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    await page.goto('/flow');
    await expect(page).toHaveURL(/\/flow\/edit\/new$/);

    const draftId = await createFlowAndNode(page, '全链路节点A');
    await page.evaluate(async (id: string) => {
      await fetch('/api/v1/boards/default/tasks/flow/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          board_id: 'default',
          planner_session_key: 'planner-session-confirm',
          manager_session_key: 'manager-session-confirm',
          execution_session_prefix: 'exec-confirm',
          requirement: 'Flow E2E Requirement',
          nodes: [
            {
              id: `${id}-node-1`,
              title: '全链路节点A',
              description: '',
              depends_on: [],
              x: 120,
              y: 120,
              layer: 0,
              sensitive: false,
              status: 'queued',
              agent_id: 'planner',
              instance_id: 'instance-e2e',
            },
          ],
          edges: [],
          messages: [],
        }),
      });
    }, draftId);
    await expect.poll(() => calls.confirm).toBe(1);

    await expect(page.getByTestId('flow-canvas-viewport')).toBeVisible();
  });

  test('covers multi-round editing with refresh/switch and stale draft conflict hint', async ({ page }) => {
    const { seedDrafts } = await installFlowMockServer(page);

    const draftA: DraftRecord = {
      id: 'draft_multi_a',
      name: '多轮草稿A',
      requirement: '',
      nodes: [
        {
          id: 'node_a_1',
          title: 'A节点',
          description: '',
          depends_on: [],
          x: 120,
          y: 120,
          layer: 0,
          sensitive: false,
          status: 'queued',
          agent_id: 'planner',
          instance_id: 'instance-e2e',
        },
      ],
      edges: [],
      lanes: [],
      node_lane_by_id: {},
      planner_messages: [],
      planner_session_key: null,
      execution_session_prefix: null,
      executor_agent_id: null,
      revision: 1,
      created_at: nowIso(),
      updated_at: nowIso(),
    };

    const draftB: DraftRecord = {
      ...draftA,
      id: 'draft_multi_b',
      name: '多轮草稿B',
      nodes: [
        {
          id: 'node_b_1',
          title: 'B节点',
          description: '',
          depends_on: [],
          x: 180,
          y: 180,
          layer: 0,
          sensitive: false,
          status: 'queued',
          agent_id: 'planner',
          instance_id: 'instance-e2e',
        },
      ],
    };
    seedDrafts([draftA, draftB]);

    await page.goto('/flow/edit/draft_multi_a');
    await expect(page.getByRole('button', { name: '流程节点-A节点' })).toBeVisible();

    await page.goto('/flow/edit/draft_multi_b');
    await expect(page).toHaveURL(/\/flow\/edit\/draft_multi_b$/);
    await expect(page.getByRole('button', { name: '流程节点-B节点' })).toBeVisible();
    await expect(page.getByRole('button', { name: '流程节点-A节点' })).toHaveCount(0);
    await closeFlowSidebarDrawer(page);

    await page.reload();
    await expect(page.getByRole('button', { name: '流程节点-B节点' })).toBeVisible();

    await page.goto('/kanban');
    await expect(page).toHaveURL(/\/kanban$/);
    await page.goto('/flow/edit/draft_multi_b');
    await expect(page.getByRole('button', { name: '流程节点-B节点' })).toBeVisible();

    await page.evaluate(() => {
      (window as unknown as { e2eSetUpsertConflictDraftId: (draftId: string) => void }).e2eSetUpsertConflictDraftId('draft_multi_b');
    });

    const staleStatus = await page.evaluate(async () => {
      const resp = await fetch('/api/v1/boards/default/tasks/flow/drafts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'draft_multi_b',
          name: '多轮草稿B',
          requirement: '',
          nodes: [],
          edges: [],
          planner_messages: [],
          lanes: [],
          node_lane_by_id: {},
          planner_session_key: null,
          execution_session_prefix: null,
          executor_agent_id: null,
          revision: 1,
        }),
      });
      return resp.status;
    });
    expect(staleStatus).toBe(409);
    await expect(page).toHaveURL(/\/flow\/edit\/draft_multi_b$/);
    await expect(page.getByRole('button', { name: '流程节点-B节点' })).toBeVisible();
  });

  test('keeps current flow safe from delayed old planner response overwrite', async ({ page }) => {
    const { seedDrafts } = await installFlowMockServer(page);

    const draftA: DraftRecord = {
      id: 'draft_delay_a',
      name: '延迟草稿A',
      requirement: '',
      nodes: [],
      edges: [],
      lanes: [],
      node_lane_by_id: {},
      planner_messages: [],
      planner_session_key: null,
      execution_session_prefix: null,
      executor_agent_id: null,
      revision: 1,
      created_at: nowIso(),
      updated_at: nowIso(),
    };

    const draftB: DraftRecord = {
      ...draftA,
      id: 'draft_delay_b',
      name: '延迟草稿B',
      nodes: [
        {
          id: 'node_b_baseline',
          title: 'B基线节点',
          description: '',
          depends_on: [],
          x: 180,
          y: 180,
          layer: 0,
          sensitive: false,
          status: 'queued',
          agent_id: 'planner',
          instance_id: 'instance-e2e',
        },
      ],
    };

    seedDrafts([draftA, draftB]);

    await page.goto('/flow/edit/draft_delay_a');
    const plannerInput = page.getByTestId('flow-planner-input');
    const firstGenerateRequest = page.waitForRequest((request) => {
      if (request.method() !== 'POST') {
        return false;
      }
      if (!request.url().includes('/api/v1/boards/default/tasks/flow/generate')) {
        return false;
      }
      return (request.postData() ?? '').includes('A流程先发');
    });
    await expect(plannerInput).toBeVisible();
    await expect(plannerInput).toBeEnabled();
    await plannerInput.fill('A流程先发');
    await plannerInput.press('Enter');
    await firstGenerateRequest;

    await page.goto('/flow/edit/draft_delay_b');
    await expect(page).toHaveURL(/\/flow\/edit\/draft_delay_b$/);
    await expect(page.getByRole('button', { name: '流程节点-B基线节点' })).toBeVisible();

    const secondGenerateResponse = page.waitForResponse((response) => {
      if (response.request().method() !== 'POST') {
        return false;
      }
      if (!response.url().includes('/api/v1/boards/default/tasks/flow/generate')) {
        return false;
      }
      return (response.request().postData() ?? '').includes('B流程后发');
    });
    await expect(plannerInput).toBeEnabled();
    await plannerInput.fill('B流程后发');
    await plannerInput.press('Enter');
    await secondGenerateResponse;

    await page.waitForTimeout(1700);
    await expect(page.getByRole('button', { name: '流程节点-B基线节点' })).toBeVisible();
    await expect(page.getByRole('button', { name: '流程节点-旧会话节点' })).toHaveCount(0);
  });
});
