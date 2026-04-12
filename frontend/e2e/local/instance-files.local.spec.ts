import { expect, type Page, type Route, test } from '@playwright/test';

type MockTaskFile = {
  id: string;
  task_id: string;
  agent_id: string;
  agent_name: string;
  task_title: string;
  task_status: 'queued' | 'running' | 'blocked_by_approval' | 'failed' | 'completed';
  requirement_id: string | null;
  requirement_title: string | null;
  path: string;
  name: string;
  exists: boolean;
  size_bytes: number | null;
  updated_at: string;
};

type MockAgentDoc = {
  id: string;
  agent_id: string;
  agent_name: string;
  path: string;
  name: string;
  exists: boolean;
  size_bytes: number | null;
  updated_at: string;
};

function nowIso(): string {
  return '2026-04-11T09:00:00Z';
}

async function fulfillJson(route: Route, payload: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  });
}

async function installInstanceFilesApiMocks(page: Page): Promise<void> {
  const taskFiles: MockTaskFile[] = [
    {
      id: 'task-1:/home/node/.openclaw/workspace/demo/out.json',
      task_id: 'task-1',
      agent_id: 'agent-1',
      agent_name: 'Alpha Agent',
      task_title: '产出节点',
      task_status: 'completed',
      requirement_id: 'req-demo',
      requirement_title: '演示流程',
      path: '/home/node/.openclaw/workspace/demo/out.json',
      name: 'out.json',
      exists: true,
      size_bytes: 18,
      updated_at: nowIso(),
    },
  ];
  const fileContentByPath = new Map<string, string>([
    ['/home/node/.openclaw/workspace/demo/out.json', '{"result":"ok"}'],
  ]);

  const agentDocs: MockAgentDoc[] = [
    {
      id: 'agent-1:SOUL.md',
      agent_id: 'agent-1',
      agent_name: 'Claw Planner',
      path: 'agent://agent-1/SOUL.md',
      name: 'SOUL.md',
      exists: true,
      size_bytes: 36,
      updated_at: nowIso(),
    },
    {
      id: 'agent-2:MEMORY.md',
      agent_id: 'agent-2',
      agent_name: 'Beta Reviewer',
      path: 'agent://agent-2/MEMORY.md',
      name: 'MEMORY.md',
      exists: true,
      size_bytes: 20,
      updated_at: nowIso(),
    },
  ];

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
      await fulfillJson(route, {
        request_id: 'req-instance-files-local',
        freshness: { status: 'fresh', checked_at: nowIso() },
        partial_failure: false,
        diagnostics: [],
        agents: [],
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
      return;
    }

    if (pathname === '/api/v1/instances' && method === 'GET') {
      await fulfillJson(route, [
        {
          id: 'inst-1',
          name: 'claw1',
          type: 'openclaw',
          endpoint: 'http://127.0.0.1:28789',
          status: 'healthy',
          last_check_at: nowIso(),
          created_at: nowIso(),
        },
      ]);
      return;
    }

    if (pathname === '/api/v1/instances/inst-1/files' && method === 'GET') {
      await fulfillJson(route, {
        items: taskFiles,
        total: taskFiles.length,
        existing_count: taskFiles.filter((item) => item.exists).length,
      });
      return;
    }

    if (pathname === '/api/v1/instances/inst-1/files/preview' && method === 'GET') {
      const path = url.searchParams.get('path') ?? '';
      if (!fileContentByPath.has(path)) {
        await fulfillJson(route, { detail: 'Output file not found' }, 404);
        return;
      }
      const content = fileContentByPath.get(path) ?? '';
      await fulfillJson(route, {
        path,
        kind: path.endsWith('.json') ? 'json' : 'text',
        mime_type: path.endsWith('.json') ? 'application/json' : 'text/plain',
        size_bytes: content.length,
        truncated: false,
        content,
        download_url: '/instances/inst-1/files/download?taskId=task-1',
      });
      return;
    }

    if (pathname === '/api/v1/instances/inst-1/files/write' && method === 'POST') {
      const body = (request.postDataJSON() as Record<string, unknown>) ?? {};
      const path = String(body.path ?? '').trim();
      const content = String(body.content ?? '');
      if (!path) {
        await fulfillJson(route, { detail: 'path is required' }, 400);
        return;
      }
      fileContentByPath.set(path, content);
      const existing = taskFiles.find((item) => item.path === path);
      if (!existing) {
        taskFiles.push({
          id: `task-1:${path}`,
          task_id: 'task-1',
          agent_id: 'agent-1',
          agent_name: 'Alpha Agent',
          task_title: '产出节点',
          task_status: 'completed',
          requirement_id: 'req-demo',
          requirement_title: '演示流程',
          path,
          name: path.split('/').pop() || path,
          exists: true,
          size_bytes: content.length,
          updated_at: nowIso(),
        });
      } else {
        existing.exists = true;
        existing.size_bytes = content.length;
        existing.updated_at = nowIso();
      }
      await fulfillJson(route, {
        path,
        size_bytes: content.length,
        updated_at: nowIso(),
        exists: true,
      });
      return;
    }

    if (pathname === '/api/v1/instances/inst-1/files' && method === 'DELETE') {
      const path = url.searchParams.get('path') ?? '';
      const index = taskFiles.findIndex((item) => item.path === path);
      if (index >= 0) {
        taskFiles.splice(index, 1);
      }
      fileContentByPath.delete(path);
      await fulfillJson(route, {
        path,
        deleted: true,
        updated_at: nowIso(),
      });
      return;
    }

    if (pathname === '/api/v1/instances/inst-1/agent-docs' && method === 'GET') {
      await fulfillJson(route, {
        items: agentDocs,
        total: agentDocs.length,
        existing_count: agentDocs.filter((item) => item.exists).length,
      });
      return;
    }

    if (pathname === '/api/v1/instances/inst-1/agent-docs/preview' && method === 'GET') {
      await fulfillJson(route, {
        path: 'agent://agent-1/SOUL.md',
        kind: 'text',
        mime_type: 'text/markdown',
        size_bytes: 36,
        truncated: false,
        content: '# Soul\n\nReadonly.',
        download_url: '/instances/inst-1/agent-docs/download?agentId=agent-1&name=SOUL.md',
      });
      return;
    }

    await fulfillJson(route, {});
  });
}

test.describe('instance files local e2e', () => {
  test('covers create/edit/delete and md readonly guard on files page', async ({ page }) => {
    await installInstanceFilesApiMocks(page);

    await page.goto('/files');
    const sidebar = page.getByTestId('instance-files-sidebar');
    const main = page.getByTestId('instance-files-main');

    await expect(page.getByRole('button', { name: '查看任务文件 out.json' })).toBeVisible();
    await expect(page.getByRole('button', { name: '查看 Agent 文档 SOUL.md' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '查看 Agent 文档 MEMORY.md' })).toHaveCount(0);

    const agentsConfigToggle = sidebar.getByRole('button', { name: '切换 Agents配置' });
    await expect(agentsConfigToggle).toHaveAttribute('aria-expanded', 'false');
    await agentsConfigToggle.click();
    await expect(agentsConfigToggle).toHaveAttribute('aria-expanded', 'true');

    // Agents 配置按 agent 分组展示：需要能看到分组标题和组内文档按钮。
    await expect(sidebar.getByText('Claw Planner')).toBeVisible();
    await expect(sidebar.getByText('Beta Reviewer')).toBeVisible();
    await expect(page.getByRole('button', { name: '查看 Agent 文档 SOUL.md' })).toBeVisible();
    await expect(page.getByRole('button', { name: '查看 Agent 文档 MEMORY.md' })).toBeVisible();

    // 新增：从文件树标题右侧 + 按钮进入弹窗创建。
    await sidebar.getByRole('button', { name: '新增任务文件' }).click();
    await expect(page.getByRole('dialog', { name: '新增任务文件' })).toBeVisible();
    await page.getByRole('textbox', { name: '新文件名' }).fill('new-created.json');

    const createWriteRequestPromise = page.waitForRequest((req) => {
      if (!req.url().includes('/api/v1/instances/inst-1/files/write')) {
        return false;
      }
      const data = req.postDataJSON() as Record<string, unknown>;
      return String(data.path ?? '').endsWith('/new-created.json') && String(data.content ?? '') === '';
    });
    await page.getByRole('button', { name: '创建' }).click();
    await createWriteRequestPromise;
    await expect(page.getByRole('button', { name: '查看任务文件 new-created.json' })).toBeVisible();

    // 编辑保存：任务文件可编辑并触发 write 请求。
    await page.getByRole('button', { name: '查看任务文件 out.json' }).click();
    await main.getByRole('button', { name: '编辑' }).click();
    await main.getByLabel('文件编辑器').fill('{"result":"updated"}');
    const saveWriteRequestPromise = page.waitForRequest((req) => {
      if (!req.url().includes('/api/v1/instances/inst-1/files/write')) {
        return false;
      }
      const data = req.postDataJSON() as Record<string, unknown>;
      return String(data.path ?? '').endsWith('/out.json') && String(data.content ?? '') === '{"result":"updated"}';
    });
    await main.getByRole('button', { name: '保存' }).click();
    await saveWriteRequestPromise;

    // 删除：任务文件删除走 delete 请求并从文件树移除。
    page.once('dialog', (dialog) => dialog.accept());
    const deleteRequestPromise = page.waitForRequest((req) =>
      req.method() === 'DELETE' && req.url().includes('/api/v1/instances/inst-1/files?')
    );
    await main.getByRole('button', { name: '删除' }).click();
    await deleteRequestPromise;
    await expect(page.getByRole('button', { name: '查看任务文件 out.json' })).toHaveCount(0);

    // Agent 文档 md 只读：文档权限可见，编辑/删除禁用，文档信息区无新增按钮。
    if ((await agentsConfigToggle.getAttribute('aria-expanded')) !== 'true') {
      await agentsConfigToggle.click();
    }
    await expect(page.getByRole('button', { name: '查看 Agent 文档 SOUL.md' })).toBeVisible();
    await page.getByRole('button', { name: '查看 Agent 文档 SOUL.md' }).click();
    await expect(main.getByText('文档权限：只读（MD 锁定）')).toBeVisible();
    await expect(main.getByRole('button', { name: '编辑' })).toBeDisabled();
    await expect(main.getByRole('button', { name: '删除' })).toBeDisabled();
    await expect(main.getByRole('button', { name: '新增' })).toHaveCount(0);
  });
});
