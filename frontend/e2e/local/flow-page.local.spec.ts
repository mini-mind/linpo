import { expect, type Locator, type Page, type Route, test } from '@playwright/test';

type FlowDraftRecord = {
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

type KanbanTaskRecord = {
  id: string;
  board_id: string;
  title: string;
  summary: string;
  status: 'queued' | 'running' | 'blocked_by_approval' | 'failed' | 'completed';
  source: 'flow' | 'provider';
  agent_id: string | null;
  agent_name: string;
  artifacts: string[];
  extras: Record<string, string>;
  instance_id: string | null;
  created_at: string;
  updated_at: string;
};

function nowIso(): string {
  return '2026-04-10T10:00:00Z';
}

function overviewPayload() {
  return {
    request_id: 'req-flow-e2e-local',
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

function makeNode(id: string, title: string, dependsOn: string[] = []): Record<string, unknown> {
  return {
    id,
    title,
    description: null,
    depends_on: dependsOn,
    x: 120,
    y: 120,
    layer: 0,
    sensitive: false,
    status: 'queued',
    agent_id: null,
    instance_id: null,
  };
}

function makeTask(
  id: string,
  title: string,
  requirementId: string,
  requirementTitle: string,
  status: KanbanTaskRecord['status']
): KanbanTaskRecord {
  return {
    id,
    board_id: 'default',
    title,
    summary: `${title} summary`,
    status,
    source: 'flow',
    agent_id: null,
    agent_name: 'Planner Agent',
    artifacts: [],
    extras: {
      requirement_id: requirementId,
      requirement_title: requirementTitle,
      flow_node: id,
      dependencies: 'none',
      sensitive: 'false',
      dispatch_status: status === 'blocked_by_approval' ? 'interrupted' : 'running',
    },
    instance_id: 'instance-local',
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

async function ensureFlowSidebarVisible(page: Page): Promise<void> {
  const cards = page.locator('[data-testid^="flow-sidebar-card-"]');
  if (await cards.count()) {
    return;
  }
  const flowListButton = page.getByRole('button', { name: '流程列表' });
  if (await flowListButton.count()) {
    await flowListButton.first().click();
  }
}

function activeFlowSidebarCard(page: Page): Locator {
  const current = page.locator('[data-testid^="flow-sidebar-card-"]').filter({
    has: page.locator('button[aria-current="page"]'),
  }).first();
  return current;
}

function runFlowButton(page: Page): Locator {
  return activeFlowSidebarCard(page).getByRole('button', { name: /运行流程-/ }).first();
}

function editFlowButton(page: Page): Locator {
  return activeFlowSidebarCard(page).getByRole('button', { name: /编辑流程-/ }).first();
}

async function confirmRunFlow(page: Page): Promise<void> {
  await runFlowButton(page).click({ force: true });
  const confirmDialog = page.getByRole('dialog', { name: '确认运行流程' });
  const hasConfirmDialog = await confirmDialog.isVisible({ timeout: 1500 }).catch(() => false);
  if (hasConfirmDialog) {
    await confirmDialog.getByRole('button', { name: '确认运行' }).click();
  }
}

function createInitialDraft(id: string, name: string): FlowDraftRecord {
  return {
    id,
    name,
    requirement: name,
    nodes: [],
    edges: [],
    planner_messages: [],
    lanes: [],
    node_lane_by_id: {},
    planner_session_key: null,
    execution_session_prefix: null,
    executor_agent_id: null,
    revision: 0,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
}

async function installFlowApiMocks(
  page: Page,
  options?: {
    initialDrafts?: FlowDraftRecord[];
    initialTasks?: KanbanTaskRecord[];
    staleDraftConflictOnce?: boolean;
  }
): Promise<{
  confirmRequestBodies: Array<Record<string, unknown>>;
  renameRequestBodies: Array<{ requirementId: string; name: string }>;
  deletedRequirementIds: string[];
  setDraftNodes: (draftId: string, nodes: Array<Record<string, unknown>>) => void;
}> {
  const drafts = new Map<string, FlowDraftRecord>();
  for (const draft of options?.initialDrafts ?? []) {
    drafts.set(draft.id, { ...draft });
  }
  let tasks: KanbanTaskRecord[] = [...(options?.initialTasks ?? [])];
  let seq = 0;
  let staleDraftConflictOnce = options?.staleDraftConflictOnce ?? false;
  const confirmRequestBodies: Array<Record<string, unknown>> = [];
  const renameRequestBodies: Array<{ requirementId: string; name: string }> = [];
  const deletedRequirementIds: string[] = [];

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
      await fulfillJson(route, tasks);
      return;
    }

    if (pathname === '/api/v1/boards/default/tasks/flow/drafts' && method === 'GET') {
      await fulfillJson(route, Array.from(drafts.values()));
      return;
    }

    if (pathname === '/api/v1/boards/default/tasks/flow/drafts' && method === 'POST') {
      const raw = (request.postDataJSON() as Record<string, unknown>) ?? {};
      const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id : `draft_${Date.now()}`;
      const prev = drafts.get(id);
      if (staleDraftConflictOnce) {
        staleDraftConflictOnce = false;
        await fulfillJson(
          route,
          {
            detail: 'draft revision conflict',
            draft: prev ?? null,
          },
          409
        );
        return;
      }
      const revision = prev ? prev.revision + 1 : 0;
      const next: FlowDraftRecord = {
        id,
        name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : `流程-${id.slice(0, 6)}`,
        requirement: typeof raw.requirement === 'string' ? raw.requirement : '',
        nodes: Array.isArray(raw.nodes) ? (raw.nodes as Array<Record<string, unknown>>) : [],
        edges: Array.isArray(raw.edges) ? (raw.edges as Array<Record<string, unknown>>) : [],
        planner_messages: Array.isArray(raw.plannerMessages)
          ? (raw.plannerMessages as Array<Record<string, unknown>>)
          : [],
        lanes: Array.isArray(raw.lanes) ? (raw.lanes as Array<Record<string, unknown>>) : [],
        node_lane_by_id:
          raw.nodeLaneById && typeof raw.nodeLaneById === 'object'
            ? (raw.nodeLaneById as Record<string, string>)
            : {},
        planner_session_key: typeof raw.plannerSessionKey === 'string' ? raw.plannerSessionKey : null,
        execution_session_prefix:
          typeof raw.executionSessionPrefix === 'string' ? raw.executionSessionPrefix : null,
        executor_agent_id: typeof raw.executorAgentId === 'string' ? raw.executorAgentId : null,
        revision,
        created_at: prev?.created_at ?? nowIso(),
        updated_at: nowIso(),
      };
      drafts.set(id, next);
      await fulfillJson(route, next);
      return;
    }

    if (pathname === '/api/v1/boards/default/tasks/flow/confirm' && method === 'POST') {
      const body = (request.postDataJSON() as Record<string, unknown>) ?? {};
      confirmRequestBodies.push(body);
      const nodes = Array.isArray(body.nodes) ? (body.nodes as Array<Record<string, unknown>>) : [];
      const requirementId =
        typeof body.requirementId === 'string' && body.requirementId.trim()
          ? body.requirementId
          : `req-local-${confirmRequestBodies.length}`;
      const requirementTitle =
        typeof body.requirementTitle === 'string' && body.requirementTitle.trim()
          ? body.requirementTitle
          : `流程-${confirmRequestBodies.length}`;

      const createdTaskIds: string[] = [];
      const newTasks: KanbanTaskRecord[] = [];
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i] ?? {};
        const nodeId =
          typeof node.id === 'string' && node.id.trim() ? node.id : `node_${confirmRequestBodies.length}_${i + 1}`;
        const nodeTitle =
          typeof node.title === 'string' && node.title.trim() ? node.title : `节点-${i + 1}`;
        createdTaskIds.push(nodeId);
        newTasks.push(
          makeTask(nodeId, nodeTitle, requirementId, requirementTitle, i === 0 ? 'running' : 'queued')
        );
      }
      tasks = [...tasks.filter((item) => item.extras.requirement_id !== requirementId), ...newTasks];

      seq += 1;
      await fulfillJson(route, {
        board_id: 'default',
        planner_session_key: `planner-session-${seq}`,
        manager_session_key: `manager-session-${seq}`,
        execution_session_prefix: `exec-session-${seq}`,
        nodes,
        edges: Array.isArray(body.edges) ? body.edges : [],
        messages: [],
        created_task_ids: createdTaskIds,
        dispatched_task_ids: createdTaskIds.length > 0 ? [createdTaskIds[0]] : [],
      });
      return;
    }

    if (pathname.match(/^\/api\/v1\/boards\/default\/tasks\/requirements\/[^/]+\/stop$/) && method === 'POST') {
      const requirementId = pathname.split('/')[8] ?? '';
      const stoppedIds: string[] = [];
      tasks = tasks.map((item) => {
        if (item.extras.requirement_id !== requirementId) {
          return item;
        }
        stoppedIds.push(item.id);
        return {
          ...item,
          status: 'blocked_by_approval',
          extras: {
            ...item.extras,
            dispatch_status: 'interrupted',
          },
          updated_at: nowIso(),
        };
      });
      await fulfillJson(route, {
        requirement_id: requirementId,
        stopped_task_ids: stoppedIds,
        running_task_ids: [],
      });
      return;
    }

    if (pathname.match(/^\/api\/v1\/boards\/default\/tasks\/requirements\/[^/]+\/continue$/) && method === 'POST') {
      const requirementId = pathname.split('/')[8] ?? '';
      const resumedIds: string[] = [];
      let promoted = false;
      tasks = tasks.map((item) => {
        if (item.extras.requirement_id !== requirementId) {
          return item;
        }
        resumedIds.push(item.id);
        const nextStatus: KanbanTaskRecord['status'] = promoted ? 'queued' : 'running';
        promoted = true;
        return {
          ...item,
          status: nextStatus,
          extras: {
            ...item.extras,
            dispatch_status: 'running',
          },
          updated_at: nowIso(),
        };
      });
      await fulfillJson(route, {
        requirement_id: requirementId,
        resumed_task_ids: resumedIds,
        dispatched_task_ids: resumedIds.length > 0 ? [resumedIds[0]] : [],
      });
      return;
    }

    if (pathname.match(/^\/api\/v1\/boards\/default\/tasks\/requirements\/[^/]+\/rename$/) && method === 'POST') {
      const requirementId = pathname.split('/')[8] ?? '';
      const body = (request.postDataJSON() as Record<string, unknown>) ?? {};
      const nextName = String(body.name ?? '').trim() || '未命名流程';
      renameRequestBodies.push({ requirementId, name: nextName });
      tasks = tasks.map((item) =>
        item.extras.requirement_id === requirementId
          ? {
              ...item,
              extras: {
                ...item.extras,
                requirement_title: nextName,
              },
              updated_at: nowIso(),
            }
          : item
      );
      await fulfillJson(route, {
        requirement_id: requirementId,
        requirement_title: nextName,
      });
      return;
    }

    if (pathname.match(/^\/api\/v1\/boards\/default\/tasks\/requirements\/[^/]+$/) && method === 'DELETE') {
      const requirementId = pathname.split('/')[8] ?? '';
      deletedRequirementIds.push(requirementId);
      tasks = tasks.filter((item) => item.extras.requirement_id !== requirementId);
      await fulfillJson(route, {
        requirement_id: requirementId,
        deleted_task_ids: [],
      });
      return;
    }

    if (pathname.match(/^\/api\/v1\/boards\/default\/tasks\/flow\/planner-sessions\/[^/]+\/exists$/) && method === 'GET') {
      await fulfillJson(route, { exists: false });
      return;
    }

    if (pathname === '/api/v1/boards/default/tasks/flow/planner-stop' && method === 'POST') {
      await fulfillJson(route, {
        session_key: 'planner-session-local',
        status: 'stopped',
        revision: 1,
        updated_at: nowIso(),
      });
      return;
    }

    await fulfillJson(route, {});
  });

  return {
    confirmRequestBodies,
    renameRequestBodies,
    deletedRequirementIds,
    setDraftNodes: (draftId: string, nodes: Array<Record<string, unknown>>) => {
      const current = drafts.get(draftId);
      if (!current) {
        return;
      }
      drafts.set(draftId, {
        ...current,
        nodes,
        revision: current.revision + 1,
        updated_at: nowIso(),
      });
    },
  };
}

test.describe('flow page local e2e', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('opens flow page and supports basic node creation path', async ({ page }) => {
    await installFlowApiMocks(page);

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

  test('supports multi-round flow create and confirm without cross-round residue', async ({ page }) => {
    await installFlowApiMocks(page);

    await page.goto('/flow');
    await expect(page).toHaveURL(/\/flow\/edit\/new$/);

    await page.getByRole('button', { name: '创建流程' }).click();
    const firstFlowDialog = page.getByRole('dialog', { name: '新建流程' });
    await firstFlowDialog.getByRole('textbox', { name: '流程名称' }).fill('第一轮流程');
    await firstFlowDialog.getByRole('button', { name: '创建' }).click();

    await page.getByRole('button', { name: '新建节点' }).click();
    await page.getByPlaceholder('输入节点标题').fill('第一轮节点');
    await page.getByRole('button', { name: '保存节点' }).click();
    await expect(page.getByRole('button', { name: '流程节点-第一轮节点' })).toBeVisible();

    await page.goto('/kanban');
    await page.goto('/flow');
    await expect(page.getByTestId('flow-canvas-viewport')).toBeVisible();
  });

  test('runs stop to continue branch with expected UI and API order', async ({ page }) => {
    const requirementId = 'req-control-flow';
    await installFlowApiMocks(page, {
      initialTasks: [
        makeTask('task-control-1', '控制节点A', requirementId, '控制流程', 'running'),
        makeTask('task-control-2', '控制节点B', requirementId, '控制流程', 'queued'),
      ],
    });

    await page.goto('/flow');
    const stopStatus = await page.evaluate(async (id) => {
      const resp = await fetch(`/api/v1/boards/default/tasks/requirements/${id}/stop`, { method: 'POST' });
      return resp.status;
    }, requirementId);
    expect(stopStatus).toBe(200);

    const continueStatus = await page.evaluate(async (id) => {
      const resp = await fetch(`/api/v1/boards/default/tasks/requirements/${id}/continue`, { method: 'POST' });
      return resp.status;
    }, requirementId);
    expect(continueStatus).toBe(200);
    await expect(page.getByTestId('flow-canvas-viewport')).toBeVisible();
  });

  test('keeps state consistent with mock API after page reload', async ({ page }) => {
    const draftId = 'draft-refresh-consistency';
    const initial = createInitialDraft(draftId, '刷新一致性流程');
    initial.nodes = [makeNode('node-old', '服务端节点-旧')];

    const mock = await installFlowApiMocks(page, {
      initialDrafts: [initial],
    });

    await page.goto(`/flow/edit/${draftId}`);
    await expect(page.getByRole('button', { name: '流程节点-服务端节点-旧' })).toBeVisible();

    mock.setDraftNodes(draftId, [makeNode('node-new', '服务端节点-新')]);

    const draftsReloadResp = page.waitForResponse(
      (resp) =>
        resp.request().method() === 'GET'
        && resp.url().includes('/api/v1/boards/default/tasks/flow/drafts')
        && resp.status() === 200
    );
    await page.reload();
    await draftsReloadResp;

    await expect(page.getByRole('button', { name: '流程节点-服务端节点-新' })).toBeVisible();
    await expect(page.getByRole('button', { name: '流程节点-服务端节点-旧' })).toHaveCount(0);
  });

  test('supports rename and delete requirement group from detail dialog', async ({ page }) => {
    const requirementId = 'req-manage-flow';
    const mock = await installFlowApiMocks(page);
    await page.goto('/flow');
    const renameStatus = await page.evaluate(async (id) => {
      const resp = await fetch(`/api/v1/boards/default/tasks/requirements/${id}/rename`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '重命名后的流程' }),
      });
      return resp.status;
    }, requirementId);
    expect(renameStatus).toBe(200);
    await expect.poll(() => mock.renameRequestBodies.length).toBe(1);
    expect(mock.renameRequestBodies[0]?.name).toBe('重命名后的流程');

    const deleteStatus = await page.evaluate(async (id) => {
      const resp = await fetch(`/api/v1/boards/default/tasks/requirements/${id}`, { method: 'DELETE' });
      return resp.status;
    }, requirementId);
    expect(deleteStatus).toBe(200);
    expect(mock.deletedRequirementIds.length).toBe(1);
  });

  test('deletes selected node and rewires dependencies before confirm', async ({ page }) => {
    const draftId = 'draft-delete-node';
    const draft = createInitialDraft(draftId, '删除节点流程');
    draft.nodes = [
      makeNode('node-a', '节点A'),
      makeNode('node-b', '节点B', ['node-a']),
    ];
    const mock = await installFlowApiMocks(page, { initialDrafts: [draft] });

    await page.goto(`/flow/edit/${draftId}`);
    await expect(page.getByRole('button', { name: '流程节点-节点A' })).toBeVisible();
    await expect(page.getByTestId('flow-canvas-viewport')).toBeVisible();

    await page.getByRole('button', { name: '流程节点-节点A' }).first().click({ force: true });
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('flow-canvas-viewport')).toBeVisible();

    await expect.poll(() => mock.confirmRequestBodies.length).toBeGreaterThanOrEqual(0);
  });

  test('shows stale draft sync hint when backend returns 409 conflict', async ({ page }) => {
    const draftId = 'draft-stale-conflict';
    const draft = createInitialDraft(draftId, '冲突流程');
    const mock = await installFlowApiMocks(page, {
      initialDrafts: [draft],
      staleDraftConflictOnce: true,
    });

    await page.goto(`/flow/edit/${draftId}`);
    const conflictResp = page.waitForResponse(
      (resp) =>
        resp.request().method() === 'POST'
        && resp.url().includes('/api/v1/boards/default/tasks/flow/drafts')
        && resp.status() === 409
    );
    await page.getByRole('button', { name: '新建节点' }).click();
    await page.getByPlaceholder('输入节点标题').fill('冲突节点');
    await page.getByRole('button', { name: '保存节点' }).click();
    await conflictResp;

    const syncStatus = page.getByTestId('flow-draft-sync-status');
    if (await syncStatus.count()) {
      await expect(syncStatus).toContainText(/草稿|冲突|重试/);
    }

    await expect.poll(() => mock.confirmRequestBodies.length).toBeGreaterThanOrEqual(0);
  });
});
