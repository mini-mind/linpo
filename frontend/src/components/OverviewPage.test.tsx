import { render, screen, waitFor } from "@testing-library/react";
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

const aggregateOverviewFixture = {
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
};

const degradedOverviewFixture = {
	request_id: "req-overview-2",
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
				request_id: "req-overview-2",
				recoverable: true,
				next_step: "检查实例连通性或网关 token 后重试",
			},
		},
		{
			instance_id: "instance-healthy",
			instance_name: "healthy-instance",
			status: "ok",
			freshness: {
				status: "fresh",
				checked_at: "2026-03-22T11:55:00Z",
			},
			error: null,
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

const zeroAgentOverviewFixture = {
	request_id: "req-overview-3",
	freshness: {
		status: "fresh",
		checked_at: "2026-03-22T12:05:00Z",
	},
	partial_failure: false,
	diagnostics: [
		{
			instance_id: "instance-empty",
			instance_name: "empty-instance",
			status: "ok",
			freshness: {
				status: "fresh",
				checked_at: "2026-03-22T12:05:00Z",
			},
			error: null,
		},
	],
	agents: [],
};

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

	describe("agents-first hierarchy", () => {
		it("places agents grid as the main visual content, not summary strip", async () => {
			mockGetAggregateOverview.mockResolvedValue(aggregateOverviewFixture);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByText("Alpha Agent")).toBeInTheDocument();
			});

			// Agents grid must exist and contain agent cards
			const agentsGrid = screen.getByTestId("overview-agents-grid");
			expect(agentsGrid).toBeInTheDocument();
			expect(agentsGrid).toHaveTextContent("Alpha Agent");
			expect(agentsGrid).toHaveTextContent("Beta Agent");

			// Summary strip should be compact (exist but not dominate)
			const summaryStrip = screen.getByTestId("overview-summary-strip");
			expect(summaryStrip).toBeInTheDocument();
		});

		it("does not render large stats grid above agents", async () => {
			mockGetAggregateOverview.mockResolvedValue(aggregateOverviewFixture);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByText("Alpha Agent")).toBeInTheDocument();
			});

			// Should NOT have a dedicated stats section with big numbers
			// The old stats grid had items like "全部 agents", "活跃中", "值得巡视"
			expect(screen.queryByText("全部 agents")).not.toBeInTheDocument();
			expect(screen.queryByText("活跃中")).not.toBeInTheDocument();
		});

		it("does not render full-width diagnostics section", async () => {
			mockGetAggregateOverview.mockResolvedValue(degradedOverviewFixture);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByText("Healthy Agent")).toBeInTheDocument();
			});

			// Should NOT have a "实例诊断" section header (old full-width diagnostics)
			expect(screen.queryByText("实例诊断")).not.toBeInTheDocument();
		});
	});

	describe("canonical drill-down", () => {
		it("renders each agent card with link to canonical session drill-down", async () => {
			mockGetAggregateOverview.mockResolvedValue(aggregateOverviewFixture);

			renderWithRouter();

			await waitFor(() => {
				expect(mockGetAggregateOverview).toHaveBeenCalledTimes(1);
			});

			expect(listInstancesSpy).not.toHaveBeenCalled();
			expect(screen.getByText("Alpha Agent")).toBeInTheDocument();
			expect(screen.getByText("Beta Agent")).toBeInTheDocument();

			expect(
				screen.getByRole("link", { name: /进入会话 - Alpha Agent/i }),
			).toHaveAttribute("href", "/session/instance-alpha/agent-alpha");
			expect(
				screen.getByRole("link", { name: /进入会话 - Beta Agent/i }),
			).toHaveAttribute("href", "/session/instance-beta/agent-beta");
		});
	});

	describe("summary strip", () => {
		it("shows compact freshness and key counts, not large dashboard cards", async () => {
			mockGetAggregateOverview.mockResolvedValue(aggregateOverviewFixture);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByText("Alpha Agent")).toBeInTheDocument();
			});

			const summaryStrip = screen.getByTestId("overview-summary-strip");
			expect(summaryStrip).toHaveTextContent("freshness");
			expect(summaryStrip).toHaveTextContent("agents");
			expect(summaryStrip).toHaveTextContent("2");
		});

		it("surfaces partial-failure status in summary strip, not full diagnostics panel", async () => {
			mockGetAggregateOverview.mockResolvedValue(degradedOverviewFixture);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByText("Healthy Agent")).toBeInTheDocument();
			});

			const summaryStrip = screen.getByTestId("overview-summary-strip");
			// Degraded status should appear in summary strip
			expect(summaryStrip).toHaveTextContent("stale");
		});
	});

	describe("empty state", () => {
		it("guides users to topology when no agents exist", async () => {
			mockGetAggregateOverview.mockResolvedValue(zeroAgentOverviewFixture);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByText("当前没有可下钻的 agent")).toBeInTheDocument();
			});

			expect(
				screen.getByRole("link", { name: /前往拓扑/i }),
			).toHaveAttribute("href", "/topology");
		});
	});

	describe("error handling", () => {
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

			expect(screen.getByText("错误: Unauthorized")).toBeInTheDocument();
			expect(screen.getByText("request_id · req-overview-401")).toBeInTheDocument();
			expect(screen.getByText("recoverable · true")).toBeInTheDocument();
			expect(screen.getByText("重新登录后重试")).toBeInTheDocument();
		});
	});

	describe("page shell testid contracts", () => {
		it("exposes overview-summary-strip testid on the summary panel", async () => {
			mockGetAggregateOverview.mockResolvedValue(aggregateOverviewFixture);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByText("Alpha Agent")).toBeInTheDocument();
			});

			const summaryStrip = screen.getByTestId("overview-summary-strip");
			expect(summaryStrip).toBeInTheDocument();
		});

		it("exposes overview-agents-grid testid on the agents grid", async () => {
			mockGetAggregateOverview.mockResolvedValue(aggregateOverviewFixture);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByText("Alpha Agent")).toBeInTheDocument();
			});

			const agentsGrid = screen.getByTestId("overview-agents-grid");
			expect(agentsGrid).toBeInTheDocument();
			expect(agentsGrid).toHaveTextContent("Alpha Agent");
			expect(agentsGrid).toHaveTextContent("Beta Agent");
		});
	});
});