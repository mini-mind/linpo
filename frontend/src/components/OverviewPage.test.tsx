import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

	it("renders aggregated agents and links each card to canonical session drill-down", async () => {
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

	it("keeps partial-failure overview readable and surfaces freshness plus diagnostics", async () => {
		mockGetAggregateOverview.mockResolvedValue(degradedOverviewFixture);

		renderWithRouter();

		await waitFor(() => {
			expect(screen.getByText("Healthy Agent")).toBeInTheDocument();
		});

		expect(screen.getByText("聚合 freshness")).toBeInTheDocument();
		expect(screen.getByText("stale · 2026-03-22T11:55:00Z")).toBeInTheDocument();
		expect(screen.getByText("failing-instance")).toBeInTheDocument();
		expect(
			screen.getByText("OpenClaw upstream unavailable"),
		).toBeInTheDocument();
		expect(screen.getByText("code · source_unavailable")).toBeInTheDocument();
		expect(screen.getByText("request_id · req-overview-2")).toBeInTheDocument();
		expect(screen.getByText("recoverable · true")).toBeInTheDocument();
		expect(screen.getByText("checked_at · 2026-03-22T11:50:00Z")).toBeInTheDocument();
		expect(
			screen.getByText("检查实例连通性或网关 token 后重试"),
		).toBeInTheDocument();
	});

	it("uses watchlist wording instead of error wording when aggregate returns zero agents", async () => {
		mockGetAggregateOverview.mockResolvedValue(zeroAgentOverviewFixture);

		renderWithRouter();

		await waitFor(() => {
			expect(screen.getByText("当前没有可下钻的 agent")).toBeInTheDocument();
		});

		expect(
			screen.getByText("先巡视 watchlist 与接入状态，确认哪些实例值得继续观察。"),
		).toBeInTheDocument();
		expect(screen.queryByText(/^错误:/i)).not.toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: /前往拓扑/i }),
		).toHaveAttribute("href", "/topology");
	});
});
