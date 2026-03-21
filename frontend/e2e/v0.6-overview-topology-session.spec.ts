import { expect, type Page, type Route, test } from "@playwright/test";

const DEFAULT_BASE_URL =
	process.env.PLAYWRIGHT_BASE_URL ?? "http://175.178.213.10:5173";
const DEFAULT_PASSWORD = "secret-123";
const HEALTHY_OPENCLAW_ENDPOINT = "http://175.178.213.10:18789";
const HEALTHY_OPENCLAW_GATEWAY_TOKEN =
	"lhdWYU1MGLCWNwbHaQsIjlPkiSt5LKhEh9PjAtElrlE";

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

test.describe("v0.6 browser acceptance", () => {
	test("v0.6 covers register login overview topology and session drill-down on deployed UI", async ({
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
		await expect(page.getByText("全部 agents", { exact: true })).toBeVisible();
		await expect(page.getByText("活跃中")).toBeVisible();
		await expect(page.getByText("值得巡视")).toBeVisible();
		await expect(page.getByText("聚合 freshness")).toBeVisible();
		await expect(page.getByText("request id")).toBeVisible();
		await expect(page.getByText(instanceName).first()).toBeVisible();
		await expect(
			page.getByRole("link", { name: "进入会话 - main" }),
		).toHaveAttribute("href", new RegExp(`/session/${instance.id}/main$`));

		await logout(page);
		await login(page, credentials.username, credentials.password);

		await page.getByRole("link", { name: "进入会话 - main" }).click();
		await expect(page).toHaveURL(new RegExp(`/session/${instance.id}/main$`));
		await expect(
			page.getByRole("button", { name: new RegExp(instanceName) }),
		).toBeVisible();

		await page.goto("/topology");
		await expect(page.locator('section[aria-label="topology-page"]')).toBeVisible();
		await expect(page.getByText("聚合 freshness")).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "技能关系" }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "外接 ACP" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: `配置实例 ${instanceName}` }),
		).toBeVisible();

		await page.getByRole("button", { name: `配置实例 ${instanceName}` }).click();
		await expect(page.getByRole("dialog")).toBeVisible();
		await expect(page.getByText("编辑实例")).toBeVisible();
		await expect(page.getByLabel("实例名称")).toHaveValue(instanceName);
		await expect(page.getByLabel("端点地址")).toHaveValue(HEALTHY_OPENCLAW_ENDPOINT);
		await page.getByRole("button", { name: "取消" }).click();
		await expect(page.getByRole("dialog")).toBeHidden();

		await page.getByRole("link", { name: `进入实例 ${instanceName}` }).first().click();
		await expect(page).toHaveURL(new RegExp(`/session/${instance.id}/main$`));
	});

	test("v0.6 keeps degraded overview and topology diagnostics visible", async ({
		page,
	}) => {
		const credentials = buildUniqueCredentials("v06-degraded");

		await register(page, credentials.username, credentials.password);

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

		const topologyInstances = [
			{
				id: "instance-healthy",
				name: "healthy-instance",
				type: "openclaw",
				endpoint: HEALTHY_OPENCLAW_ENDPOINT,
				status: "connected",
				last_check_at: "2026-03-22T11:55:00Z",
				created_at: "2026-03-22T11:00:00Z",
			},
			{
				id: "instance-failing",
				name: "failing-instance",
				type: "openclaw",
				endpoint: "http://175.178.213.10:28789",
				status: "disconnected",
				last_check_at: "2026-03-22T11:50:00Z",
				created_at: "2026-03-22T10:00:00Z",
			},
		];

		await page.route(/\/aggregate\/overview\?/, async (route) => {
			await fulfillJson(route, degradedOverview);
		});
		await page.route(/\/aggregate\/topology\?/, async (route) => {
			await fulfillJson(route, degradedTopology);
		});
		await page.route(/\/instances$/, async (route) => {
			if (route.request().method() !== "GET") {
				await route.continue();
				return;
			}
			await fulfillJson(route, topologyInstances);
		});

		await page.goto("/overview");
		await expect(page.getByText("部分降级")).toBeVisible();
		await expect(page.getByText("OpenClaw upstream unavailable")).toBeVisible();
		await expect(page.getByText("code · source_unavailable")).toBeVisible();
		await expect(
			page.getByText("request_id · req-v06-overview-degraded"),
		).toBeVisible();
		await expect(page.getByText("recoverable · true")).toBeVisible();
		await expect(
			page.getByRole("link", { name: "进入会话 - Healthy Agent" }),
		).toHaveAttribute("href", "/session/instance-healthy/agent-healthy");

		await page.goto("/topology");
		await expect(page.locator('section[aria-label="topology-page"]')).toBeVisible();
		await expect(page.getByText("OpenClaw upstream unavailable")).toBeVisible();
		await expect(
			page.getByText("request_id · req-v06-topology-degraded"),
		).toBeVisible();
		await expect(page.getByText("recoverable · true")).toBeVisible();
		await expect(
			page.getByRole("link", { name: "进入 agent Healthy Agent" }),
		).toHaveAttribute("href", "/session/instance-healthy/agent-healthy");
	});
});
