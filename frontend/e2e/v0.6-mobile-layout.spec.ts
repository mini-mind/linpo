import { expect, type Page, type Route, test } from "@playwright/test";

const DEFAULT_PASSWORD = "secret-123";

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
	await page.getByPlaceholder("用户名").fill(username);
	await page.getByPlaceholder("密码", { exact: true }).fill(password);
	await page.getByPlaceholder("确认密码").fill(password);
	await page.getByRole("button", { name: "注册" }).click();
	await expect(page).toHaveURL(/\/overview$/);
}

function overviewPayload() {
	return {
		request_id: "req-mobile-overview",
		freshness: { status: "fresh", checked_at: "2026-03-26T02:00:00Z" },
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
				last_active_at: "2026-03-26T02:00:00Z",
				drilldown_path: "/session/main/__none__/__new__?instanceId=instance-demo",
			},
		],
		stats: {
			instance_count: 1,
			agent_count: 1,
			active_agent_count: 1,
			attention_instance_count: 0,
			total_tokens: 100,
		},
		token_groups: [
			{
				instance_id: "instance-demo",
				instance_name: "demo-instance",
				total_tokens: 100,
				samples: [{ label: "02:00", input_tokens: 60, output_tokens: 40, total_tokens: 100 }],
			},
		],
		global_events: [],
	};
}

function topologyPayload() {
	return {
		request_id: "req-mobile-topology",
		freshness: { status: "fresh", checked_at: "2026-03-26T02:00:00Z" },
		partial_failure: false,
		diagnostics: [],
		instances: [
			{
				node_id: "instance:instance-demo",
				instance_id: "instance-demo",
				name: "demo-instance",
				type: "openclaw",
				status: "active",
				last_check_at: "2026-03-26T02:00:00Z",
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
				last_active_at: "2026-03-26T02:00:00Z",
				drilldown_path: "/session/main/__none__/__new__?instanceId=instance-demo",
			},
		],
		sessions: [],
		tools: [],
		edges: [
			{
				source: "instance:instance-demo",
				target: "agent:instance-demo:main",
				kind: "instance_agent",
			},
		],
	};
}

test.describe("v0.6 移动端布局验收", () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test("Round M1: IA 内总览 icon/底部导航与会话输入区可用", async ({ page }) => {
		const credentials = buildUniqueCredentials("mobile-layout");
		await register(page, credentials.username, credentials.password);

		const nav = page.getByRole("navigation", { name: "主导航" });
		await expect(nav).toBeVisible();
		await expect(nav.getByRole("link", { name: "总览" })).toBeVisible();
		await expect(nav.getByRole("button", { name: "打开账户菜单" })).toBeVisible();

		await page.route(/\/aggregate\/overview(\?.*)?$/, async (route) => {
			await fulfillJson(route, overviewPayload());
		});
		await page.route(/\/aggregate\/topology(\?.*)?$/, async (route) => {
			await fulfillJson(route, topologyPayload());
		});
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
						last_message_preview: null,
						updated_at: Math.floor(Date.now() / 1000),
					},
				],
				defaults: { model: "gpt-5.3-codex" },
			});
		});
		await page.route(/\/chat\/sessions\/session-1\/history\?limit=200(\&.*)?$/, async (route) => {
			await fulfillJson(route, {
				ts: Date.now(),
				items: [{ role: "assistant", text: "mobile-history" }],
			});
		});
		await page.route(/\/agents\/main(\?.*)?$/, async (route) => {
			await fulfillJson(route, {
				id: "main",
				name: "Main Agent",
				status: "running",
				is_active: true,
				root_node_id: "node-1",
				root_child_count: 1,
				total_node_count: 1,
				last_active_at: "2026-03-26T02:00:00Z",
				nodes: [{ id: "node-1", name: "root", status: "running", is_active: true, child_count: 0, parent_id: null }],
			});
		});

		await page.getByRole("link", { name: /拓扑/ }).first().click({ force: true });
		await expect(page).toHaveURL(/\/topology$/);
		await expect(page.getByTestId("topology-graph-canvas")).toBeAttached();
		await page.getByRole("link", { name: /看板/ }).first().click({ force: true });
		await expect(page).toHaveURL(/\/kanban$/);
		await expect(page.getByRole("heading", { name: "推进中" })).toBeAttached();
		await page.getByRole("link", { name: /团队/ }).first().click({ force: true });
		await expect(page).toHaveURL(/\/team$/);
		await expect(page.getByRole("heading", { name: "Main Agent" })).toBeAttached();

		await page.goto("/session/main/__none__/__new__?instanceId=instance-demo");
		await expect(page.getByTestId("session-stream-shell")).toBeVisible();
		const messageInput = page.getByLabel("消息输入");
		await expect(messageInput).toBeVisible();

		const navBox = await nav.boundingBox();
		const inputBox = await messageInput.boundingBox();
		expect(navBox).not.toBeNull();
		expect(inputBox).not.toBeNull();
		if (navBox && inputBox) {
			expect(inputBox.y + inputBox.height).toBeLessThanOrEqual(navBox.y + 1);
		}
	});
});
