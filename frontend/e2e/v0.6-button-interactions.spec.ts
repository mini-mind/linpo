import { expect, type Page, type Route, test } from "@playwright/test";

const API_BASE_URL = "http://175.178.213.10:8000";
const DEFAULT_PASSWORD = "secret-123";
const HEALTHY_OPENCLAW_ENDPOINT = "http://175.178.213.10:18789";
const HEALTHY_OPENCLAW_GATEWAY_TOKEN =
	"lhdWYU1MGLCWNwbHaQsIjlPkiSt5LKhEh9PjAtElrlE";

function buildUniqueCredentials(prefix: string): {
	username: string;
	password: string;
} {
	const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	return {
		username: `${prefix}-${suffix}`.replace(/[^a-z0-9-]/gi, "").toLowerCase(),
		password: DEFAULT_PASSWORD,
	};
}

async function fulfillJson(route: Route, payload: unknown, status = 200): Promise<void> {
	await route.fulfill({
		status,
		contentType: "application/json",
		body: JSON.stringify(payload),
	});
}

async function register(page: Page, username: string, password: string): Promise<void> {
	await page.goto("/login");
	await page.getByRole("button", { name: "注册新账号" }).click();
	await expect(page.getByRole("heading", { name: "注册账号" })).toBeVisible();
	await page.getByPlaceholder("用户名").fill(username);
	await page.getByPlaceholder("密码", { exact: true }).fill(password);
	await page.getByPlaceholder("确认密码").fill(password);
	await page.getByRole("button", { name: "注册" }).click();
	await expect(page).toHaveURL(/\/overview$/);
}

async function login(page: Page, username: string, password: string): Promise<void> {
	await page.getByPlaceholder("用户名").fill(username);
	await page.getByPlaceholder("密码", { exact: true }).fill(password);
	await page.getByRole("button", { name: "登录" }).click();
	await expect(page).not.toHaveURL(/\/login$/);
}

async function logout(page: Page): Promise<void> {
	await page.getByRole("button", { name: "打开账户菜单" }).click();
	await page.getByRole("menuitem", { name: "退出登录" }).click();
	await expect(page).toHaveURL(/\/login$/);
}

async function createInstance(
	page: Page,
	{
		name,
		endpoint,
		gatewayToken,
	}: {
		name: string;
		endpoint: string;
		gatewayToken: string;
	},
): Promise<{ id: string; name: string }> {
	const response = await page.evaluate(
		async ({ apiBaseUrl, payload }) => {
			const res = await fetch(`${apiBaseUrl}/instances`, {
				method: "POST",
				credentials: "include",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(payload),
			});
			const text = await res.text();
			return { status: res.status, text };
		},
		{
			apiBaseUrl: API_BASE_URL,
			payload: {
				name,
				type: "openclaw",
				endpoint,
				gatewayToken,
			},
		},
	);

	if (response.status !== 201) {
		throw new Error(`create instance failed: ${response.status} ${response.text}`);
	}

	return JSON.parse(response.text) as { id: string; name: string };
}

function overviewPayload() {
	return {
		request_id: "req-overview-buttons",
		freshness: {
			status: "fresh",
			checked_at: "2026-03-26T01:00:00Z",
		},
		partial_failure: false,
		diagnostics: [],
		agents: [
			{
				instance_id: "instance-demo",
				instance_name: "demo-instance",
				agent_id: "main",
				agent_name: "Main Agent",
				status: "running",
				is_active: true,
				last_active_at: "2026-03-26T01:00:00Z",
				drilldown_path: "/session/main/__none__/__new__?instanceId=instance-demo",
			},
			{
				instance_id: "instance-demo",
				instance_name: "demo-instance",
				agent_id: "idle-agent",
				agent_name: "Idle Agent",
				status: "idle",
				is_active: false,
				last_active_at: null,
				drilldown_path: "/invalid-drilldown",
			},
		],
		stats: {
			instance_count: 1,
			agent_count: 2,
			active_agent_count: 1,
			attention_instance_count: 0,
			total_tokens: 200,
		},
		token_groups: [
			{
				instance_id: "instance-demo",
				instance_name: "demo-instance",
				total_tokens: 200,
				samples: [
					{
						label: "01:00",
						input_tokens: 120,
						output_tokens: 80,
						total_tokens: 200,
					},
				],
			},
		],
		global_events: [
			{
				id: "event-1",
				instance_id: "instance-demo",
				instance_name: "demo-instance",
				agent_id: "main",
				agent_name: "Main Agent",
				type: "activity_started",
				timestamp: "2026-03-26T01:00:00Z",
				description: "按钮验收场景",
			},
		],
	};
}

function emptyOverviewPayload() {
	return {
		...overviewPayload(),
		agents: [],
		stats: {
			instance_count: 0,
			agent_count: 0,
			active_agent_count: 0,
			attention_instance_count: 0,
			total_tokens: 0,
		},
		token_groups: [],
		global_events: [],
	};
}

function teamDisabledOverviewPayload() {
	return {
		...overviewPayload(),
		agents: [
			{
				instance_id: "",
				instance_name: "invalid-instance",
				agent_id: "",
				agent_name: "Missing Context Agent",
				status: "idle",
				is_active: false,
				last_active_at: null,
				drilldown_path: "",
			},
		],
	};
}

function topologyPayload() {
	return {
		request_id: "req-topology-buttons",
		freshness: {
			status: "fresh",
			checked_at: "2026-03-26T01:00:00Z",
		},
		partial_failure: false,
		diagnostics: [],
		instances: [
			{
				node_id: "instance:instance-demo",
				instance_id: "instance-demo",
				name: "demo-instance",
				type: "openclaw",
				status: "active",
				last_check_at: "2026-03-26T01:00:00Z",
				created_at: "2026-03-26T00:00:00Z",
			},
		],
		agents: [
			{
				node_id: "agent:instance-demo:main",
				instance_id: "instance-demo",
				instance_name: "demo-instance",
				agent_id: "main",
				agent_name: "Main Agent",
				status: "running",
				is_active: true,
				last_active_at: "2026-03-26T01:00:00Z",
				drilldown_path: "/session/main/__none__/__new__?instanceId=instance-demo",
			},
		],
		sessions: [
			{
				node_id: "session:instance-demo:main:agent:main:main",
				instance_id: "instance-demo",
				instance_name: "demo-instance",
				agent_id: "main",
				agent_name: "Main Agent",
				session_key: "session-1",
				label: "session-1",
				updated_at: "2026-03-26T01:00:00Z",
			},
		],
		tools: [],
		edges: [
			{
				source: "instance:instance-demo",
				target: "agent:instance-demo:main",
				kind: "instance_agent",
			},
			{
				source: "agent:instance-demo:main",
				target: "session:instance-demo:main:agent:main:main",
				kind: "agent_session",
			},
		],
	};
}

test.describe("v0.6 按钮交互验收", () => {
	test.describe.configure({ timeout: 180_000 });

	test("Round 0: 注册 + OpenClaw 接入 + 关键按钮真链路验证", async ({ page }) => {
		const credentials = buildUniqueCredentials("btn-round0");
		const instanceName = `btn-openclaw-${credentials.username.slice(-6)}`;

		await register(page, credentials.username, credentials.password);
		const instance = await createInstance(page, {
			name: instanceName,
			endpoint: HEALTHY_OPENCLAW_ENDPOINT,
			gatewayToken: HEALTHY_OPENCLAW_GATEWAY_TOKEN,
		});

		await page.goto("/overview");
		await expect(page.getByTestId("overview-stats-panel")).toBeVisible();
		const overviewRetry = page.getByRole("button", { name: "重试" });
		if ((await overviewRetry.count()) > 0) {
			await overviewRetry.first().click();
		}
		const overviewRefresh = page.getByRole("button", { name: "刷新" });
		if ((await overviewRefresh.count()) > 0) {
			await overviewRefresh.first().click();
		}

		await page.goto("/topology");
		await expect(page.getByTestId("topology-graph-canvas")).toBeVisible();
		const topologyRetry = page.getByRole("button", { name: "重试" });
		if ((await topologyRetry.count()) > 0) {
			await topologyRetry.first().click();
		}
		await page.getByRole("button", { name: "适配画布" }).click({ force: true });
		await page.getByRole("button", { name: "刷新" }).click({ force: true });

		await page.goto("/session/main/__none__/__new__?instanceId=" + instance.id);
		await expect(page.getByTestId("session-stream-shell")).toBeVisible();
		await expect(page.getByTestId("session-input-shell")).toBeVisible();

		await logout(page);
		await login(page, credentials.username, credentials.password);
		await expect(page).not.toHaveURL(/\/login$/);
	});

	test("Round 1: 页面级按钮交互（登录/总览/拓扑/看板/团队）", async ({ page }) => {
		const credentials = buildUniqueCredentials("btn-round1");

		await register(page, credentials.username, credentials.password);

		const closeToastButton = page.getByRole("button", { name: "关闭提示" }).first();
		if ((await closeToastButton.count()) > 0) {
			await closeToastButton.click();
		}

		await logout(page);
		await expect(page.getByRole("heading", { name: "登录到灵盘" })).toBeVisible();
		await login(page, credentials.username, credentials.password);
		await expect(page).not.toHaveURL(/\/login$/);
		await page.getByRole("link", { name: /总览/ }).first().click();

		const overviewRoute = /\/aggregate\/overview(\?.*)?$/;
		let overviewCall = 0;
		const overviewHandler = async (route: Route) => {
			overviewCall += 1;
			if (overviewCall === 1) {
				await fulfillJson(
					route,
					{
						error: {
							code: "source_unavailable",
							message: "overview temporarily unavailable",
							request_id: "req-overview-error",
							recoverable: true,
							next_step: "retry",
						},
					},
					503,
				);
				return;
			}
			await fulfillJson(route, overviewPayload());
		};
		await page.route(overviewRoute, overviewHandler);

		await page.goto("/overview");
		await expect(page.getByRole("heading", { name: "总览暂时不可用" })).toBeVisible();
		await page.getByRole("button", { name: "重试" }).click();
		await expect(page.getByRole("button", { name: "刷新" })).toBeVisible();
		await page.getByRole("button", { name: "刷新" }).click({ force: true });
		await expect(
			page.getByTestId("overview-token-stage").getByRole("heading", {
				name: "demo-instance",
			}),
		).toBeVisible();
		await page.unroute(overviewRoute, overviewHandler);

		const topologyRoute = /\/aggregate\/topology(\?.*)?$/;
		let topologyCall = 0;
		const topologyHandler = async (route: Route) => {
			topologyCall += 1;
			if (topologyCall === 1) {
				await fulfillJson(
					route,
					{
						error: {
							code: "source_unavailable",
							message: "topology temporarily unavailable",
							request_id: "req-topology-error",
							recoverable: true,
							next_step: "retry",
						},
					},
					503,
				);
				return;
			}
			await fulfillJson(route, topologyPayload());
		};
		await page.route(topologyRoute, topologyHandler);

		await page.getByRole("link", { name: /拓扑/ }).first().click();
		await expect(page.getByRole("heading", { name: "拓扑暂时不可用" })).toBeVisible();
		await page.getByRole("button", { name: "重试" }).click();
		await expect(page.getByRole("button", { name: "适配画布" })).toBeVisible();
		await page.getByRole("button", { name: "适配画布" }).click({ force: true });
		await page.getByRole("button", { name: "刷新" }).click({ force: true });
		await expect(page.getByTestId("topology-node-agent-main")).toBeVisible();
		await page.getByRole("link", { name: "进入默认会话" }).first().click();
		await expect(page).toHaveURL(/\/session\/main\/__none__\/__new__/);
		await page.unroute(topologyRoute, topologyHandler);

		const kanbanRoute = /\/aggregate\/overview(\?.*)?$/;
		const kanbanHandler = async (route: Route) => {
			await fulfillJson(route, overviewPayload());
		};
		await page.route(kanbanRoute, kanbanHandler);

		await page.getByRole("link", { name: /看板/ }).first().click();
		await expect(page.getByTestId("kanban-board")).toBeVisible();
		await expect(page.getByRole("button", { name: "进入任务上下文" }).first()).toBeVisible();
		await page.getByRole("button", { name: "进入任务上下文" }).first().click();
		await expect(page.getByRole("button", { name: "收起任务上下文" }).first()).toBeVisible();
		await expect(page.getByRole("button", { name: "进入 session 工作区", exact: true }).last()).toBeDisabled();
		await page.getByRole("link", { name: "进入 session 工作区" }).first().click();
		await expect(page).toHaveURL(/\/session\/main\/__none__\/__new__/);
		await page.unroute(kanbanRoute, kanbanHandler);

		const teamAggregateRoute = /\/aggregate\/overview(\?.*)?$/;
		let teamCall = 0;
		const teamAggregateHandler = async (route: Route) => {
			teamCall += 1;
			if (teamCall === 1) {
				await fulfillJson(
					route,
					{
						error: {
							code: "source_unavailable",
							message: "team temporarily unavailable",
							request_id: "req-team-error",
							recoverable: true,
							next_step: "retry",
						},
					},
					503,
				);
				return;
			}
			await fulfillJson(route, overviewPayload());
		};
		await page.route(teamAggregateRoute, teamAggregateHandler);
		await page.route(/\/chat\/sessions\?agentId=main.*$/, async (route) => {
			await fulfillJson(route, {
				ts: Date.now(),
				count: 1,
				sessions: [
					{
						key: "session-1",
						kind: "direct",
						label: "Session 1",
						derived_title: "Session 1",
						last_message_preview: "hello",
						updated_at: Math.floor(Date.now() / 1000),
					},
				],
				defaults: { model: "gpt-5.3-codex" },
			});
		});
		await page.route(/\/chat\/sessions\/preview\?.*$/, async (route) => {
			await fulfillJson(route, {
				ts: Date.now(),
				previews: [
					{
						key: "session-1",
						status: "ok",
						items: [{ role: "assistant", text: "hello" }],
					},
				],
			});
		});

		await page.getByRole("link", { name: /团队/ }).first().click();
		await expect(page.getByRole("heading", { name: "团队页暂时不可用" })).toBeVisible();
		await page.getByRole("button", { name: "重试" }).click();
		await page.getByTestId("team-agent-card-main").click();
		await expect(page).toHaveURL(/\/session\/main\/__none__\/__new__/);
		await page.getByRole("link", { name: /团队/ }).first().click();
		await expect(page).toHaveURL(/\/team$/);
		const activeSessionLink = page
			.getByTestId("team-agent-card-main")
			.locator("a", { hasText: "进入最近活跃会话" });
		await expect(activeSessionLink).toBeVisible();
		await activeSessionLink.click();
		await expect(page).toHaveURL(/\/session\/main\/__none__\/__new__/);
	});

	test("Round 2: 会话工作区按钮交互（会话切换/发送/暂停/重置/删除）", async ({ page }) => {
		const credentials = buildUniqueCredentials("btn-round2");
		await register(page, credentials.username, credentials.password);

		await page.route(/\/agents\/main(\?.*)?$/, async (route) => {
			await fulfillJson(route, {
				id: "main",
				name: "Main Agent",
				status: "running",
				is_active: true,
				root_node_id: "node-1",
				root_child_count: 1,
				total_node_count: 1,
				last_active_at: "2026-03-26T01:00:00Z",
				nodes: [
					{
						id: "node-1",
						name: "root",
						status: "running",
						is_active: true,
						child_count: 0,
						parent_id: null,
					},
				],
			});
		});
		await page.route(/\/chat\/sessions\?agentId=main(\&.*)?$/, async (route) => {
			await fulfillJson(route, {
				ts: Date.now(),
				count: 2,
				sessions: [
					{
						key: "session-1",
						kind: "direct",
						label: "Session 1",
						derived_title: "First Session",
						last_message_preview: null,
						updated_at: Math.floor(Date.now() / 1000),
					},
					{
						key: "session-2",
						kind: "direct",
						label: "Session 2",
						derived_title: "Second Session",
						last_message_preview: null,
						updated_at: Math.floor(Date.now() / 1000),
					},
				],
				defaults: { model: "gpt-5.3-codex" },
			});
		});
		await page.route(/\/chat\/sessions\/session-(1|2)\/history\?limit=200(\&.*)?$/, async (route) => {
			const isSecond = route.request().url().includes("session-2");
			await fulfillJson(route, {
				ts: Date.now(),
				items: [{ role: "assistant", text: isSecond ? "history-2" : "history-1" }],
			});
		});
		await page.route(/\/chat\/agents\/main\/send(\?.*)?$/, async (route) => {
			await fulfillJson(route, {
				request_id: "req-send",
				agent_id: "main",
				status: "accepted",
			});
		});
		await page.route(/\/chat\/agents\/main\/pause(\?.*)?$/, async (route) => {
			await fulfillJson(route, {
				request_id: "req-pause",
				agent_id: "main",
				status: "accepted",
			});
		});
		await page.route(/\/chat\/sessions\/session-(1|2)\/reset(\?.*)?$/, async (route) => {
			await fulfillJson(route, { reset: true });
		});
		await page.route(/\/chat\/sessions\/session-(1|2)(\?.*)?$/, async (route) => {
			if (route.request().method() === "DELETE") {
				await fulfillJson(route, { deleted: true });
				return;
			}
			await route.fallback();
		});

		await page.goto("/session/main/__none__/__new__?instanceId=instance-demo");
		await expect(page.getByTestId("session-stream-shell")).toBeVisible();

		await page.getByRole("button", { name: "Second Session" }).click();
		await expect(page.getByText("history-2")).toBeVisible();

		await page.getByLabel("消息输入").fill("按钮交互发送");
		await page.getByRole("button", { name: "发送" }).click();
		await expect(page.getByLabel("消息输入")).toHaveValue("");

		await page.getByRole("button", { name: "暂停" }).click();
		await expect(page.getByText("已发送暂停请求")).toBeVisible();
		await page.getByRole("button", { name: "重置会话" }).click();
		await expect(page.getByText("会话已重置")).toBeVisible();
		await page.getByRole("button", { name: "删除会话" }).click();
		await expect(page.getByText("会话已删除")).toBeVisible();

		await page.getByRole("button", { name: "关闭提示" }).first().click();
	});

	test("Round 3: 边界按钮交互（登录模式切换/看板异常重试与空态/团队禁用入口）", async ({ page }) => {
		const credentials = buildUniqueCredentials("btn-round3");

		await page.goto("/login");
		await page.getByRole("button", { name: "注册新账号" }).click();
		await expect(page.getByRole("heading", { name: "注册账号" })).toBeVisible();
		await page.getByRole("button", { name: "已有账号？去登录" }).click();
		await expect(page.getByRole("heading", { name: "登录到灵盘" })).toBeVisible();
		await register(page, credentials.username, credentials.password);

		const kanbanRoute = /\/aggregate\/overview(\?.*)?$/;
		let kanbanCall = 0;
		const kanbanHandler = async (route: Route) => {
			kanbanCall += 1;
			if (kanbanCall === 1) {
				await fulfillJson(
					route,
					{
						error: {
							code: "source_unavailable",
							message: "kanban temporarily unavailable",
							request_id: "req-kanban-error",
							recoverable: true,
							next_step: "retry",
						},
					},
					503,
				);
				return;
			}
			await fulfillJson(route, emptyOverviewPayload());
		};
		await page.route(kanbanRoute, kanbanHandler);

		await page.getByRole("link", { name: /看板/ }).first().click();
		await expect(page.getByText("任务板加载失败")).toBeVisible();
		await page.getByRole("button", { name: "重试" }).click();
		await expect(page.getByRole("link", { name: "去 topology 核对入口" })).toBeVisible();
		await page.getByRole("link", { name: "去 topology 核对入口" }).click();
		await expect(page).toHaveURL(/\/topology$/);
		await page.unroute(kanbanRoute, kanbanHandler);

		const teamRoute = /\/aggregate\/overview(\?.*)?$/;
		const teamHandler = async (route: Route) => {
			await fulfillJson(route, teamDisabledOverviewPayload());
		};
		await page.route(teamRoute, teamHandler);
		await page.getByRole("link", { name: /团队/ }).first().click();
		const disabledEntryButton = page.getByRole("button", { name: "当前不可进入 session 工作区" });
		await expect(disabledEntryButton).toBeVisible();
		await expect(disabledEntryButton).toBeDisabled();
		await page.unroute(teamRoute, teamHandler);
	});

	test.afterEach(async ({ page }) => {
		// 清理路由，避免跨测试污染。
		await page.unroute(/.*/);
	});
});
