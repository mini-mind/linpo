import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as instanceClient from "../api/instanceClient";

import { OverviewPage } from "./OverviewPage";

const { mockGetAggregateOverview } = vi.hoisted(() => ({
	mockGetAggregateOverview: vi.fn(),
}));

vi.mock("../api/client", async () => {
	const actual = await vi.importActual<typeof import("../api/client")>(
		"../api/client",
	);
	return {
		...actual,
		getAggregateOverview: mockGetAggregateOverview,
	};
});

vi.mock("../hooks/useIsMobile", () => ({
	useIsMobile: () => false,
}));

const listInstancesSpy = vi.spyOn(instanceClient, "listInstances");

const overviewFixture = {
	request_id: "req-overview-1",
	freshness: {
		status: "fresh",
		checked_at: "2026-03-22T12:00:00Z",
	},
	partial_failure: false,
	diagnostics: [
		{
			instance_id: "instance-alpha",
			instance_name: "alpha-instance",
			status: "ok",
			freshness: {
				status: "fresh",
				checked_at: "2026-03-22T12:00:00Z",
			},
			error: null,
		},
		{
			instance_id: "instance-beta",
			instance_name: "beta-instance",
			status: "failed",
			freshness: {
				status: "failed",
				checked_at: "2026-03-22T11:45:00Z",
			},
			error: {
				code: "source_unavailable",
				message: "OpenClaw upstream unavailable",
				request_id: "req-overview-1",
				recoverable: true,
				next_step: "检查实例连通性或网关 token 后重试",
			},
		},
	],
	agents: [
		{
			instance_id: "instance-alpha",
			instance_name: "alpha-instance",
			agent_id: "agent-alpha",
			agent_name: "Alpha Agent",
			status: "running",
			is_active: true,
			last_active_at: "2026-03-22T11:58:00Z",
			drilldown_path: "/session/instance-alpha/agent-alpha",
		},
		{
			instance_id: "instance-beta",
			instance_name: "beta-instance",
			agent_id: "agent-beta",
			agent_name: "Beta Agent",
			status: "error",
			is_active: false,
			last_active_at: "2026-03-21T18:00:00Z",
			drilldown_path: "/session/instance-beta/agent-beta",
		},
	],
	stats: {
		instance_count: 2,
		agent_count: 2,
		active_agent_count: 1,
		attention_instance_count: 1,
		total_tokens: 330,
	},
	token_groups: [
		{
			instance_id: "instance-alpha",
			instance_name: "alpha-instance",
			total_tokens: 330,
			samples: [
				{ label: "08:00", input_tokens: 80, output_tokens: 40, total_tokens: 120 },
				{ label: "12:00", input_tokens: 140, output_tokens: 70, total_tokens: 210 },
			],
		},
		{
			instance_id: "instance-beta",
			instance_name: "beta-instance",
			total_tokens: null,
			samples: [],
		},
	],
	global_events: [
		{
			id: "event-alpha-1",
			instance_id: "instance-alpha",
			instance_name: "alpha-instance",
			agent_id: "agent-alpha",
			agent_name: "Alpha Agent",
			type: "status_changed",
			timestamp: "2026-03-22T11:59:00Z",
			description: "Alpha Agent completed a token-heavy planning burst.",
		},
		{
			id: "event-beta-1",
			instance_id: "instance-beta",
			instance_name: "beta-instance",
			agent_id: null,
			agent_name: null,
			type: "activity_stopped",
			timestamp: "2026-03-22T11:47:00Z",
			description: "beta-instance is waiting for upstream recovery.",
		},
	],
};

function createDeferredPromise<T>(): {
	promise: Promise<T>;
	resolve: (value: T | PromiseLike<T>) => void;
	reject: (reason?: unknown) => void;
} {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function renderWithRouter(): ReturnType<typeof render> {
	return render(
		<MemoryRouter initialEntries={["/overview"]}>
			<OverviewPage />
		</MemoryRouter>,
	);
}

describe("OverviewPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		window.localStorage.clear();
		listInstancesSpy.mockRejectedValue(
			new Error("overview should not read /instances"),
		);
	});

	it("renders overview as stats topbar, token stage, and global event rail instead of agents grid", async () => {
		mockGetAggregateOverview.mockResolvedValue(overviewFixture);

		renderWithRouter();

		await waitFor(() => {
			expect(screen.getByTestId("overview-stats-panel")).toBeInTheDocument();
		});

		expect(listInstancesSpy).not.toHaveBeenCalled();

		const statsPanel = screen.getByTestId("overview-stats-panel");
		expect(statsPanel).toHaveTextContent("实例总数");
		expect(statsPanel).toHaveTextContent("活跃 agents");
		expect(statsPanel).toHaveTextContent("关注实例");
		expect(statsPanel).toHaveTextContent("Token 总量");
		expect(statsPanel).toHaveTextContent("330");

		const tokenStage = screen.getByTestId("overview-token-stage");
		expect(tokenStage).toHaveTextContent("实例 token 趋势");
		expect(tokenStage).toHaveTextContent("alpha-instance");
		expect(tokenStage).toHaveTextContent("beta-instance");
		expect(tokenStage).toHaveTextContent("暂无 token 数据");

		const eventsRail = screen.getByTestId("overview-global-events");
		expect(eventsRail).toHaveTextContent("全局事件");
		expect(eventsRail).toHaveTextContent(
			"Alpha Agent completed a token-heavy planning burst.",
		);
		expect(eventsRail).toHaveTextContent(
			"beta-instance is waiting for upstream recovery.",
		);

		expect(screen.queryByTestId("overview-agents-grid")).not.toBeInTheDocument();
	});

	it("shows request clues for reconciliation in the successful overview state", async () => {
		mockGetAggregateOverview.mockResolvedValue(overviewFixture);

		renderWithRouter();

		await waitFor(() => {
			expect(screen.getByText("request_id · req-overview-1")).toBeInTheDocument();
		});

		expect(screen.getByText("freshness · 数据新鲜")).toBeInTheDocument();
		expect(
			screen.getByText("checked_at · 2026-03-22T12:00:00Z"),
		).toBeInTheDocument();
		expect(screen.getByText("diagnostics · 2 total / 1 failed")).toBeInTheDocument();
	});

	it("re-reads aggregate overview when refresh is triggered from the successful state", async () => {
		mockGetAggregateOverview
			.mockResolvedValueOnce(overviewFixture)
			.mockResolvedValueOnce({
				...overviewFixture,
				request_id: "req-overview-2",
				freshness: {
					status: "stale",
					checked_at: "2026-03-22T12:05:00Z",
				},
			});

		renderWithRouter();

		await waitFor(() => {
			expect(screen.getByText("request_id · req-overview-1")).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole("button", { name: "刷新" }));

		await waitFor(() => {
			expect(screen.getByText("request_id · req-overview-2")).toBeInTheDocument();
		});

		expect(mockGetAggregateOverview).toHaveBeenCalledTimes(2);
		expect(screen.getByText("freshness · 数据滞后")).toBeInTheDocument();
	});

	it("keeps the overview shell visible while aggregate overview is loading", () => {
		const deferred = createDeferredPromise<typeof overviewFixture>();
		mockGetAggregateOverview.mockReturnValue(deferred.promise);

		renderWithRouter();

		expect(screen.getByRole("heading", { name: "总览" })).toBeInTheDocument();
		expect(screen.getByTestId("overview-stats-panel")).toHaveTextContent(
			"总览数据加载中",
		);
		expect(screen.getByTestId("overview-token-stage")).toHaveTextContent(
			"正在加载实例 token 趋势",
		);
		expect(screen.getByTestId("overview-global-events")).toHaveTextContent(
			"正在加载全局事件",
		);
	});

	it("keeps the overview skeleton when token groups and global events are empty", async () => {
		mockGetAggregateOverview.mockResolvedValue({
			...overviewFixture,
			diagnostics: [],
			stats: {
				...overviewFixture.stats,
				instance_count: 0,
				agent_count: 0,
				active_agent_count: 0,
				attention_instance_count: 0,
				total_tokens: null,
			},
			token_groups: [],
			global_events: [],
		});

		renderWithRouter();

		await waitFor(() => {
			expect(screen.getByTestId("overview-stats-panel")).toBeInTheDocument();
		});

		expect(screen.getByRole("heading", { name: "总览" })).toBeInTheDocument();
		expect(screen.getByTestId("overview-token-stage")).toHaveTextContent(
			"当前没有可展示的实例 token 数据",
		);
		expect(screen.getByTestId("overview-global-events")).toHaveTextContent(
			"当前没有可展示的全局事件",
		);
	});

	it("keeps the event rail rendered even when there are no global events yet", async () => {
		mockGetAggregateOverview.mockResolvedValue({
			...overviewFixture,
			global_events: [],
		});

		renderWithRouter();

		await waitFor(() => {
			expect(screen.getByTestId("overview-global-events")).toBeInTheDocument();
		});

		const eventsRail = screen.getByTestId("overview-global-events");
		expect(within(eventsRail).getByText("全局事件")).toBeInTheDocument();
		expect(within(eventsRail).getByText("当前没有可展示的全局事件")).toBeInTheDocument();
	});

	it("keeps successful overview content while surfacing a partial failure notice from diagnostics", async () => {
		mockGetAggregateOverview.mockResolvedValue({
			...overviewFixture,
			partial_failure: false,
		});

		renderWithRouter();

		await waitFor(() => {
			expect(screen.getByText("部分数据不可用")).toBeInTheDocument();
		});

		expect(screen.getByTestId("overview-token-stage")).toHaveTextContent(
			"alpha-instance",
		);
		expect(screen.getByTestId("overview-global-events")).toHaveTextContent(
			"beta-instance is waiting for upstream recovery.",
		);
	});

	it("shows a partial failure notice when the payload is explicitly marked partial_failure", async () => {
		mockGetAggregateOverview.mockResolvedValue({
			...overviewFixture,
			partial_failure: true,
			diagnostics: [overviewFixture.diagnostics[0]],
		});

		renderWithRouter();

		await waitFor(() => {
			expect(screen.getByText("部分数据不可用")).toBeInTheDocument();
		});

		expect(screen.getByTestId("overview-token-stage")).toHaveTextContent(
			"alpha-instance",
		);
	});

	it("surfaces normalized envelope fields when aggregate request returns non-2xx", async () => {
		mockGetAggregateOverview.mockRejectedValue(
			new ApiError(401, "Unauthorized", {
				code: "unauthorized",
				message: "Unauthorized",
				request_id: "req-overview-401",
				recoverable: true,
				next_step: "重新登录后重试",
			}),
		);

		renderWithRouter();

		await waitFor(() => {
			expect(screen.getByText("code · unauthorized")).toBeInTheDocument();
		});

		expect(screen.getByText("Unauthorized")).toBeInTheDocument();
		expect(screen.getByText("request_id · req-overview-401")).toBeInTheDocument();
		expect(screen.getByText("recoverable · true")).toBeInTheDocument();
		expect(screen.getByText("重新登录后重试")).toBeInTheDocument();
	});

	it("shows an explicit unauthorized state instead of a generic failure state", async () => {
		mockGetAggregateOverview.mockRejectedValue(
			new ApiError(401, "Unauthorized", {
				code: "unauthorized",
				message: "Unauthorized",
				request_id: "req-overview-401",
				recoverable: true,
				next_step: "重新登录后重试",
			}),
		);

		renderWithRouter();

		await waitFor(() => {
			expect(screen.getByText("当前无权查看总览")).toBeInTheDocument();
		});

		expect(screen.queryByText("总览暂时不可用")).not.toBeInTheDocument();
		expect(screen.getByText("request_id · req-overview-401")).toBeInTheDocument();
	});

	it("shows a readable failed state with request evidence when overview loading fails", async () => {
		mockGetAggregateOverview.mockRejectedValue(
			new ApiError(503, "OpenClaw upstream unavailable", {
				code: "source_unavailable",
				message: "OpenClaw upstream unavailable",
				request_id: "req-overview-503",
				recoverable: true,
				next_step: "检查实例连通性后重试",
			}),
		);

		renderWithRouter();

		await waitFor(() => {
			expect(screen.getByText("总览暂时不可用")).toBeInTheDocument();
		});

		expect(screen.getByText("request_id · req-overview-503")).toBeInTheDocument();
		expect(screen.getByText("code · source_unavailable")).toBeInTheDocument();
	});

	it("re-reads aggregate overview when retry is triggered from the failed state", async () => {
		mockGetAggregateOverview
			.mockRejectedValueOnce(
				new ApiError(503, "OpenClaw upstream unavailable", {
					code: "source_unavailable",
					message: "OpenClaw upstream unavailable",
					request_id: "req-overview-503",
					recoverable: true,
					next_step: "检查实例连通性后重试",
				}),
			)
			.mockResolvedValueOnce({
				...overviewFixture,
				request_id: "req-overview-recovered",
			});

		renderWithRouter();

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole("button", { name: "重试" }));

		await waitFor(() => {
			expect(screen.getByText("request_id · req-overview-recovered")).toBeInTheDocument();
		});

		expect(mockGetAggregateOverview).toHaveBeenCalledTimes(2);
	});

	it("shows an explicit stale notice while keeping overview content visible", async () => {
		mockGetAggregateOverview.mockResolvedValue({
			...overviewFixture,
			freshness: {
				status: "stale",
				checked_at: "2026-03-22T11:40:00Z",
			},
		});

		renderWithRouter();

		await waitFor(() => {
			expect(screen.getByText("当前展示的是滞后数据")).toBeInTheDocument();
		});

		expect(screen.getByTestId("overview-stats-panel")).toHaveTextContent("330");
		expect(screen.getByTestId("overview-token-stage")).toHaveTextContent(
			"alpha-instance",
		);
	});
});
