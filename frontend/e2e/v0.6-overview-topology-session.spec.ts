import { fileURLToPath } from "node:url";
import { expect, type Page, type Route, test } from "@playwright/test";

const DEFAULT_BASE_URL =
	process.env.PLAYWRIGHT_BASE_URL ?? "http://175.178.213.10:5173";
const DEFAULT_PASSWORD = "secret-123";
const HEALTHY_OPENCLAW_ENDPOINT = "http://175.178.213.10:18789";
const HEALTHY_OPENCLAW_GATEWAY_TOKEN =
	"lhdWYU1MGLCWNwbHaQsIjlPkiSt5LKhEh9PjAtElrlE";
const HAPPY_EVIDENCE_PATH = fileURLToPath(
	new URL("../../.sisyphus/evidence/task-9-playwright.png", import.meta.url),
);
const DEGRADED_EVIDENCE_PATH = fileURLToPath(
	new URL(
		"../../.sisyphus/evidence/task-9-playwright-error.png",
		import.meta.url,
	),
);
const OVERVIEW_BANNED_SELECTORS = [
	'[data-testid="overview-stats-grid"]',
	'[data-testid="dashboard-stats-grid"]',
];

const TOPOLOGY_BANNED_SELECTORS = [
	'[data-testid="topology-sidebar"]',
	'[data-testid="topology-detail-panel"]',
	'[data-testid="topology-config-panel"]',
];

const KANBAN_BANNED_SELECTORS = [
	'[data-testid="kanban-signal-grid"]',
	'[data-testid="signal-grid"]',
];

const SESSION_BANNED_SELECTORS = [
	'[data-testid="session-sidebar"]',
	'[data-testid="session-tabs"]',
	'[data-testid="session-status-panel"]',
];

function buildApiBaseUrl(): string {
	const url = new URL(DEFAULT_BASE_URL);
	url.port = "8000";
	url.pathname = "";
	url.search = "";
	url.hash = "";
	return url.toString().replace(/\/$/, "");
}

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

async function register(page: Page, username: string, password: string): Promise<void> {
	await page.goto("/login");
	await page.getByRole("button", { name: "注册新账号" }).click();
	await page.getByPlaceholder("用户名").fill(username);
	await page.getByPlaceholder("密码", { exact: true }).fill(password);
	await page.getByPlaceholder("确认密码").fill(password);
	await page.getByRole("button", { name: "注册" }).click();
	await expect(page).toHaveURL(/\/overview$/);
	await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
}

async function login(page: Page, username: string, password: string): Promise<void> {
	await page.getByPlaceholder("用户名").fill(username);
	await page.getByPlaceholder("密码", { exact: true }).fill(password);
	await page.getByRole("button", { name: "登录" }).click();
	await expect(page).toHaveURL(/\/overview$/);
	await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
}

async function logout(page: Page): Promise<void> {
	await page.getByRole("button", { name: "打开账户菜单" }).click();
	await page.getByRole("menuitem", { name: "退出登录" }).click();
	await expect(page).toHaveURL(/\/login$/);
	await expect(page.getByRole("heading", { name: "登录到灵盘" })).toBeVisible();
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
	const apiBaseUrl = buildApiBaseUrl();
	const response = await page.evaluate(
		async ({ apiBaseUrl: nextApiBaseUrl, payload }) => {
			const res = await fetch(`${nextApiBaseUrl}/instances`, {
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
			apiBaseUrl,
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

	const payload = JSON.parse(response.text) as { id: string; name: string };
	return payload;
}

async function fulfillJson(route: Route, payload: unknown): Promise<void> {
	await route.fulfill({
		status: 200,
		contentType: "application/json",
		body: JSON.stringify(payload),
	});
}

async function captureEvidence(page: Page, filePath: string): Promise<void> {
	await page.screenshot({
		path: filePath,
		fullPage: true,
	});
}

async function mockDegradedAggregateResponses(page: Page): Promise<void> {
	const degradedOverview = {
		request_id: "req-v06-overview-degraded",
		freshness: {
			status: "stale",
			checked_at: "2026-03-22T11:55:00Z",
		},
		partial_failure: true,
		diagnostics: [
			{
				instance_id: "instance-failing",
				instance_name: "failing-instance",
				status: "failed",
				freshness: {
					status: "failed",
					checked_at: "2026-03-22T11:50:00Z",
				},
				error: {
					code: "source_unavailable",
					message: "OpenClaw upstream unavailable",
					request_id: "req-v06-overview-degraded",
					recoverable: true,
					next_step: "检查实例连通性或网关 token 后重试",
				},
			},
		],
		agents: [
			{
				instance_id: "instance-healthy",
				instance_name: "healthy-instance",
				agent_id: "agent-healthy",
				agent_name: "Healthy Agent",
				status: "running",
				is_active: true,
				last_active_at: "2026-03-22T11:54:00Z",
				drilldown_path: "/session/instance-healthy/agent-healthy",
			},
			{
				instance_id: "instance-failing",
				instance_name: "failing-instance",
				agent_id: "agent-failing",
				agent_name: "Failing Agent",
				status: "error",
				is_active: false,
				last_active_at: null,
				drilldown_path: "/session/instance-failing/agent-failing",
			},
		],
	};

	const degradedTopology = {
		request_id: "req-v06-topology-degraded",
		freshness: {
			status: "stale",
			checked_at: "2026-03-22T11:55:00Z",
		},
		partial_failure: true,
		diagnostics: [
			{
				instance_id: "instance-failing",
				instance_name: "failing-instance",
				status: "failed",
				freshness: {
					status: "failed",
					checked_at: "2026-03-22T11:50:00Z",
				},
				error: {
					code: "source_unavailable",
					message: "OpenClaw upstream unavailable",
					request_id: "req-v06-topology-degraded",
					recoverable: true,
					next_step: "检查实例连通性或网关 token 后重试",
				},
			},
		],
		instances: [
			{
				node_id: "instance:instance-healthy",
				instance_id: "instance-healthy",
				name: "healthy-instance",
				type: "openclaw",
				status: "active",
				last_check_at: "2026-03-22T11:55:00Z",
				created_at: "2026-03-22T11:00:00Z",
			},
			{
				node_id: "instance:instance-failing",
				instance_id: "instance-failing",
				name: "failing-instance",
				type: "openclaw",
				status: "inactive",
				last_check_at: "2026-03-22T11:50:00Z",
				created_at: "2026-03-22T10:00:00Z",
			},
		],
		agents: [
			{
				node_id: "agent:instance-healthy:agent-healthy",
				instance_id: "instance-healthy",
				instance_name: "healthy-instance",
				agent_id: "agent-healthy",
				agent_name: "Healthy Agent",
				status: "running",
				is_active: true,
				last_active_at: "2026-03-22T11:54:00Z",
				drilldown_path: "/session/instance-healthy/agent-healthy",
			},
		],
		edges: [
			{
				source: "instance:instance-healthy",
				target: "agent:instance-healthy:agent-healthy",
				kind: "instance_agent",
			},
		],
		skills: [],
		external_acps: [],
	};

	await page.route(/\/aggregate\/overview(\?.*)?$/, async (route) => {
		await fulfillJson(route, degradedOverview);
	});
	await page.route(/\/aggregate\/topology(\?.*)?$/, async (route) => {
		await fulfillJson(route, degradedTopology);
	});
}

async function expectNoBannedStructures(page: Page, selectors: string[]): Promise<void> {
	for (const selector of selectors) {
		await expect(page.locator(selector)).toHaveCount(0);
	}
}

test.describe("v0.6 browser acceptance", () => {
	test("v0.6 ui-realignment covers register login overview topology kanban and session drill-down on deployed UI", async ({
		page,
	}) => {
		const credentials = buildUniqueCredentials("v06-real");
		const instanceName = `claw1-e2e-${credentials.username.slice(-6)}`;

		await register(page, credentials.username, credentials.password);

		const instance = await createInstance(page, {
			name: instanceName,
			endpoint: HEALTHY_OPENCLAW_ENDPOINT,
			gatewayToken: HEALTHY_OPENCLAW_GATEWAY_TOKEN,
		});

		await page.goto("/overview");
		await expect(page.getByTestId("overview-summary-strip")).toBeVisible();
		await expect(page.getByTestId("overview-agents-grid")).toBeVisible();
		await expectNoBannedStructures(page, OVERVIEW_BANNED_SELECTORS);
		await expect(page.getByText("全部 agents", { exact: true })).toHaveCount(0);
		await expect(page.getByText("活跃中", { exact: true })).toHaveCount(0);
		await expect(page.getByText("值得巡视", { exact: true })).toHaveCount(0);
		await expect(page.getByText(instanceName).first()).toBeVisible();
		const overviewMainDrilldownLink = page
			.locator(`a[href$="/session/${instance.id}/main"]`)
			.first();
		await expect(overviewMainDrilldownLink).toBeVisible();

		await logout(page);
		await login(page, credentials.username, credentials.password);

		await page.locator(`a[href$="/session/${instance.id}/main"]`).first().click();
		await expect(page).toHaveURL(new RegExp(`/session/${instance.id}/main$`));
		await expect(page.getByTestId("session-stream-shell")).toBeVisible();
		await expect(page.getByTestId("session-input-shell")).toBeVisible();
		await expectNoBannedStructures(page, SESSION_BANNED_SELECTORS);

		await page.goto("/topology");
		await expect(page.getByTestId("topology-graph-canvas")).toBeVisible();
		await expectNoBannedStructures(page, TOPOLOGY_BANNED_SELECTORS);
		await expect(page.getByRole("heading", { name: "技能关系" })).toHaveCount(0);
		await expect(page.getByRole("heading", { name: "外接 ACP" })).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: `配置实例 ${instanceName}` }),
		).toHaveCount(0);
		await expect(
			page
				.locator(`[data-testid^="drilldown-link-"][href$="/session/${instance.id}/main"]`)
				.first(),
		).toBeVisible();
		const topologyDrilldownPath = await page
			.locator(`[data-testid^="drilldown-link-"][href$="/session/${instance.id}/main"]`)
			.first()
			.getAttribute("href");
		expect(topologyDrilldownPath).toBe(`/session/${instance.id}/main`);
		await page.goto(topologyDrilldownPath ?? "/session");
		await expect(page).toHaveURL(new RegExp(`/session/${instance.id}/main$`));
		await expect(page.getByTestId("session-stream-shell")).toBeVisible();
		await expect(page.getByTestId("session-input-shell")).toBeVisible();
		await expectNoBannedStructures(page, SESSION_BANNED_SELECTORS);

		await page.goto("/kanban");
		await expect(page.locator('section[aria-label="kanban-page"]')).toBeVisible();
		await expect(page.getByTestId("kanban-board")).toBeVisible();
		await expectNoBannedStructures(page, KANBAN_BANNED_SELECTORS);
		await expect(page.getByRole("heading", { name: "看板" })).toBeVisible();
		await expect(page.getByText("聚合工作项、协作状态与关键工作信号")).toBeVisible();
		await expect(page.getByText(instanceName).first()).toBeVisible();
		await expect(page.locator(`a[href$="/session/${instance.id}/main"]`).first()).toBeVisible();
		await page.locator(`a[href$="/session/${instance.id}/main"]`).first().click();
		await expect(page).toHaveURL(new RegExp(`/session/${instance.id}/main$`));
		await expect(page.getByTestId("session-stream-shell")).toBeVisible();
		await expect(page.getByTestId("session-input-shell")).toBeVisible();
		await expectNoBannedStructures(page, SESSION_BANNED_SELECTORS);
		await captureEvidence(page, HAPPY_EVIDENCE_PATH);
	});

	test("v0.6 ui-realignment keeps degraded overview and topology diagnostics visible", async ({
		page,
	}) => {
		const credentials = buildUniqueCredentials("v06-degraded");

		await register(page, credentials.username, credentials.password);
		await mockDegradedAggregateResponses(page);

		await page.goto("/overview");
		await expect(page.getByTestId("overview-summary-strip")).toBeVisible();
		await expect(page.getByTestId("overview-agents-grid")).toBeVisible();
		await expectNoBannedStructures(page, OVERVIEW_BANNED_SELECTORS);
		await expect(page.getByText("异常实例")).toBeVisible();
		await expect(page.getByText("OpenClaw upstream unavailable")).toBeVisible();
		await expect(
			page.getByRole("link", { name: "进入会话 - Healthy Agent" }),
		).toHaveAttribute("href", "/session/instance-healthy/agent-healthy");

		await page.goto("/topology");
		await expect(page.getByTestId("topology-graph-canvas")).toBeVisible();
		await expectNoBannedStructures(page, TOPOLOGY_BANNED_SELECTORS);
		await expect(page.getByTestId("topology-node-instance-instance-healthy")).toBeVisible();
		await expect(page.getByTestId("topology-node-instance-instance-failing")).toBeVisible();
		await expect(
			page.getByTestId("drilldown-link-agent-healthy"),
		).toHaveAttribute("href", "/session/instance-healthy/agent-healthy");

		await page.goto("/kanban");
		await expect(page.locator('section[aria-label="kanban-page"]')).toBeVisible();
		await expect(page.getByTestId("kanban-board")).toBeVisible();
		await expectNoBannedStructures(page, KANBAN_BANNED_SELECTORS);
		await expect(page.getByRole("heading", { name: "看板" })).toBeVisible();
		await expect(page.getByText("部分降级")).toBeVisible();
		await expect(page.getByText("OpenClaw upstream unavailable")).toBeVisible();
		await expect(
			page.getByRole("link", { name: "进入会话 - Healthy Agent" }),
		).toHaveAttribute("href", "/session/instance-healthy/agent-healthy");
		await captureEvidence(page, DEGRADED_EVIDENCE_PATH);
	});

	test("v0.6 ui-realignment keeps overview single-column and session minimal shell on mobile", async ({
		page,
	}) => {
		const credentials = buildUniqueCredentials("v06-mobile");
		const instanceName = `claw1-mobile-${credentials.username.slice(-6)}`;

		await register(page, credentials.username, credentials.password);

		const instance = await createInstance(page, {
			name: instanceName,
			endpoint: HEALTHY_OPENCLAW_ENDPOINT,
			gatewayToken: HEALTHY_OPENCLAW_GATEWAY_TOKEN,
		});

		await page.setViewportSize({ width: 390, height: 844 });

		await page.goto("/overview");
		await expect(page.getByTestId("overview-summary-strip")).toBeVisible();
		const overviewAgentsGrid = page.getByTestId("overview-agents-grid");
		await expect(overviewAgentsGrid).toBeVisible();
		await expectNoBannedStructures(page, OVERVIEW_BANNED_SELECTORS);
		const gridTemplateColumns = await overviewAgentsGrid.evaluate(
			(element) => window.getComputedStyle(element).gridTemplateColumns,
		);
		expect(gridTemplateColumns.trim().split(/\s+/)).toHaveLength(1);
		await expect(page.getByText(instanceName).first()).toBeVisible();

		await page.goto(`/session/${instance.id}/main`);
		await expect(page).toHaveURL(new RegExp(`/session/${instance.id}/main$`));
		await expect(page.getByRole("heading", { name: "会话" })).toBeVisible();
		await expect(page.getByTestId("session-stream-shell")).toBeVisible();
		await expect(page.getByTestId("session-input-shell")).toBeVisible();
		await expectNoBannedStructures(page, SESSION_BANNED_SELECTORS);
	});
});
