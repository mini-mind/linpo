import { chromium } from '@playwright/test';

const BASE_URL = process.env.CAPTURE_BASE_URL ?? 'http://127.0.0.1:5173';

function jsonResponse(body) {
  return {
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body),
  };
}

function buildTask(id, title, status, requirementId, requirementTitle, node, agentId = 'agent-alpha') {
  return {
    id,
    board_id: 'default',
    title,
    summary: `${title} 摘要`,
    status,
    source: 'flow',
    agent_id: agentId,
    agent_name: agentId === 'agent-alpha' ? 'Alpha Agent' : 'Beta Agent',
    artifacts: [],
    extras: {
      requirement_id: requirementId,
      requirement_title: requirementTitle,
      flow_node: node,
      dependencies: 'none',
      sensitive: 'false',
    },
    instance_id: agentId === 'agent-alpha' ? 'instance-alpha' : 'instance-beta',
    created_at: '2026-04-04T01:00:00Z',
    updated_at: '2026-04-04T01:20:00Z',
  };
}

async function mockApis(context) {
  const tasks = [
    buildTask('task-1', '整理需求', 'queued', 'req-1', '支付流程', 'node_1'),
    buildTask('task-2', '生成草案', 'running', 'req-1', '支付流程', 'node_2'),
    buildTask('task-3', '敏感审批', 'blocked_by_approval', 'req-2', '风控流程', 'node_1', 'agent-beta'),
    buildTask('task-4', '上传产物', 'completed', 'req-2', '风控流程', 'node_2', 'agent-beta'),
  ];

  await context.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method().toUpperCase();

    if (path === '/api/v1/auth/me') {
      await route.fulfill(
        jsonResponse({
          id: 'user-demo',
          username: 'demo',
          email: 'demo@example.com',
          avatar_url: null,
        })
      );
      return;
    }

    if (path === '/api/v1/instances') {
      if (method === 'GET') {
        await route.fulfill(
          jsonResponse([
            {
              id: 'instance-alpha',
              name: 'claw1',
              type: 'openclaw',
              endpoint: 'http://127.0.0.1:18789',
              status: 'active',
              last_check_at: '2026-04-04T01:20:00Z',
              created_at: '2026-04-04T00:20:00Z',
            },
            {
              id: 'instance-beta',
              name: 'claw2',
              type: 'openclaw',
              endpoint: 'http://127.0.0.1:28789',
              status: 'active',
              last_check_at: '2026-04-04T01:18:00Z',
              created_at: '2026-04-04T00:28:00Z',
            },
          ])
        );
        return;
      }
      if (method === 'POST') {
        const payload = route.request().postDataJSON();
        await route.fulfill(
          jsonResponse({
            id: `instance-${Date.now()}`,
            name: payload.name ?? 'claw-new',
            type: 'openclaw',
            endpoint: payload.endpoint ?? 'http://127.0.0.1:38789',
            status: 'active',
            last_check_at: '2026-04-04T01:20:00Z',
            created_at: '2026-04-04T01:20:00Z',
          })
        );
        return;
      }
    }

    if (path === '/api/v1/summary/overview') {
      await route.fulfill(
        jsonResponse({
          request_id: 'overview-demo',
          freshness: { status: 'fresh', checked_at: '2026-04-04T01:20:00Z' },
          partial_failure: false,
          diagnostics: [],
          agents: [
            {
              instance_id: 'instance-alpha',
              instance_name: 'claw1',
              agent_id: 'agent-alpha',
              agent_name: 'Alpha Agent',
              status: 'running',
              is_active: true,
              last_active_at: '2026-04-04T01:19:00Z',
              drilldown_path: '/session/agent-alpha/__none__/__new__?instanceId=instance-alpha',
            },
            {
              instance_id: 'instance-beta',
              instance_name: 'claw2',
              agent_id: 'agent-beta',
              agent_name: 'Beta Agent',
              status: 'running',
              is_active: true,
              last_active_at: '2026-04-04T01:18:00Z',
              drilldown_path: '/session/agent-beta/__none__/__new__?instanceId=instance-beta',
            },
          ],
          stats: {
            instance_count: 2,
            agent_count: 2,
            active_agent_count: 2,
            attention_instance_count: 1,
            total_tokens: 123456,
          },
          token_groups: [
            {
              instance_id: 'instance-alpha',
              instance_name: 'claw1',
              total_tokens: 73210,
              samples: [
                { label: '04-01', input_tokens: 3200, output_tokens: 1500, total_tokens: 4700 },
                { label: '04-02', input_tokens: 4100, output_tokens: 2600, total_tokens: 6700 },
                { label: '04-03', input_tokens: 5200, output_tokens: 3100, total_tokens: 8300 },
              ],
            },
            {
              instance_id: 'instance-beta',
              instance_name: 'claw2',
              total_tokens: 50246,
              samples: [
                { label: '04-01', input_tokens: 2100, output_tokens: 900, total_tokens: 3000 },
                { label: '04-02', input_tokens: 2700, output_tokens: 1300, total_tokens: 4000 },
                { label: '04-03', input_tokens: 3600, output_tokens: 1800, total_tokens: 5400 },
              ],
            },
          ],
          global_events: [
            {
              id: 'evt-1',
              instance_id: 'instance-alpha',
              instance_name: 'claw1',
              agent_id: 'agent-alpha',
              agent_name: 'Alpha Agent',
              type: 'task.completed',
              timestamp: '2026-04-04T01:18:00Z',
              description: '完成“上传产物”节点',
            },
            {
              id: 'evt-2',
              instance_id: 'instance-beta',
              instance_name: 'claw2',
              agent_id: 'agent-beta',
              agent_name: 'Beta Agent',
              type: 'task.blocked',
              timestamp: '2026-04-04T01:19:00Z',
              description: '“敏感审批”等待人工批准',
            },
          ],
        })
      );
      return;
    }

    if (path === '/api/v1/summary/topology') {
      await route.fulfill(
        jsonResponse({
          request_id: 'topology-demo',
          freshness: { status: 'fresh', checked_at: '2026-04-04T01:20:00Z' },
          diagnostics: [],
          agents: [],
          sessions: [],
        })
      );
      return;
    }

    if (path === '/api/v1/boards/default/tasks') {
      await route.fulfill(jsonResponse(tasks));
      return;
    }

    if (path === '/api/v1/boards/default/tasks/flow/drafts') {
      await route.fulfill(jsonResponse([]));
      return;
    }

    if (path.startsWith('/api/v1/instances/') && path.endsWith('/files')) {
      await route.fulfill(
        jsonResponse({
          items: [
            {
              id: 'f-1',
              task_id: 'task-4',
              agent_id: 'agent-beta',
              agent_name: 'Beta Agent',
              task_title: '上传产物',
              task_status: 'completed',
              requirement_id: 'req-2',
              requirement_title: '风控流程',
              path: '/home/node/.openclaw/workspace/reports/final.json',
              name: 'final.json',
              exists: true,
              size_bytes: 18342,
              updated_at: '2026-04-04T01:20:00Z',
            },
          ],
          total: 1,
          existing_count: 1,
        })
      );
      return;
    }

    if (path.startsWith('/api/v1/instances/') && path.endsWith('/agent-docs')) {
      await route.fulfill(
        jsonResponse({
          items: [
            {
              id: 'doc-1',
              agent_id: 'agent-alpha',
              agent_name: 'Alpha Agent',
              path: '/home/node/.openclaw/workspace/AGENTS.md',
              name: 'AGENTS.md',
              exists: true,
              size_bytes: 2222,
              updated_at: '2026-04-04T01:18:00Z',
            },
          ],
          total: 1,
          existing_count: 1,
        })
      );
      return;
    }

    if (path.includes('/preview')) {
      await route.fulfill(
        jsonResponse({
          content: '# Demo Preview\n\nlanding capture demo',
          mime_type: 'text/markdown',
          encoding: 'utf-8',
          truncated: false,
          size_bytes: 64,
        })
      );
      return;
    }

    await route.fulfill(jsonResponse({}));
  });
}

async function waitForReady(page, routePath) {
  await page.goto(`${BASE_URL}${routePath}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1512, height: 982 },
    isMobile: false,
    hasTouch: false,
    deviceScaleFactor: 1,
  });
  await context.addInitScript(() => {
    window.localStorage.setItem('linpo.currentInstanceId', 'instance-alpha');
    window.localStorage.setItem(
      'linpo_flow_drafts_v1',
      JSON.stringify([
        {
          id: 'landing-flow-packed',
          name: '订单履约流程',
          requirement: '生成一个含并行分支的履约流程',
          nodes: [
            {
              id: 'node_plan_1',
              title: '需求拆解',
              description: '识别订单、库存、风控三个维度',
              depends_on: [],
              x: 120,
              y: 120,
              layer: 1,
              sensitive: false,
              status: 'completed',
              agent_id: 'agent-alpha',
            },
            {
              id: 'node_plan_2',
              title: '库存校验',
              description: '检查可售库存并锁定',
              depends_on: ['node_plan_1'],
              x: 430,
              y: 80,
              layer: 2,
              sensitive: false,
              status: 'running',
              agent_id: 'agent-alpha',
            },
            {
              id: 'node_plan_3',
              title: '风控审核',
              description: '命中规则时进入人工审批',
              depends_on: ['node_plan_1'],
              x: 430,
              y: 260,
              layer: 2,
              sensitive: true,
              status: 'blocked_by_approval',
              agent_id: 'agent-beta',
            },
            {
              id: 'node_plan_4',
              title: '发货执行',
              description: '生成运单并同步物流系统',
              depends_on: ['node_plan_2', 'node_plan_3'],
              x: 760,
              y: 170,
              layer: 3,
              sensitive: false,
              status: 'queued',
              agent_id: 'agent-beta',
            },
          ],
          edges: [],
          lanes: [],
          node_lane_by_id: {},
          planner_session_key: null,
          execution_session_prefix: null,
          executor_agent_id: null,
          created_at: '2026-04-04T01:00:00Z',
          updated_at: '2026-04-04T01:20:00Z',
        },
      ])
    );
  });
  await mockApis(context);
  const page = await context.newPage();

  await waitForReady(page, '/kanban');
  await page.screenshot({ path: 'public/assets/landing/kanban-main.png', fullPage: false });

  await waitForReady(page, '/flow/edit/landing-flow-packed');
  await page.screenshot({ path: 'public/assets/landing/flow-main.png', fullPage: false });

  await waitForReady(page, '/summary');
  await page.screenshot({ path: 'public/assets/landing/summary-main.png', fullPage: false });

  await waitForReady(page, '/instance-files');
  await page.screenshot({ path: 'public/assets/landing/files-main.png', fullPage: false });

  await context.close();
  await browser.close();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
