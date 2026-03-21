import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CollabPage from "./CollabPage";

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

function renderWithRouter(): ReturnType<typeof render> {
	return render(
		<MemoryRouter initialEntries={["/kanban"]}>
			<CollabPage />
		</MemoryRouter>,
	);
}

describe("CollabPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders kanban work signals and canonical session drill-down links", async () => {
		mockGetAggregateOverview.mockResolvedValue({
			request_id: "req-kanban-1",
			freshness: {
				status: "fresh",
				checked_at: "2026-03-22T12:10:00Z",
			},
			partial_failure: false,
			diagnostics: [
				{
					instance_id: "instance-alpha",
					instance_name: "alpha-instance",
					status: "ok",
					freshness: {
						status: "fresh",
						checked_at: "2026-03-22T12:10:00Z",
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
					last_active_at: "2026-03-22T12:08:00Z",
					drilldown_path: "/session/instance-alpha/agent-alpha",
				},
			],
		});

		renderWithRouter();

		await waitFor(() => {
			expect(screen.getByRole("heading", { name: "看板" })).toBeInTheDocument();
		});

		expect(screen.getByText("聚合工作项、协作状态与关键工作信号")).toBeInTheDocument();
		expect(screen.getByText("聚合 freshness")).toBeInTheDocument();
		expect(screen.getByText("Alpha Agent")).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: /进入会话 - Alpha Agent/i }),
		).toHaveAttribute("href", "/session/instance-alpha/agent-alpha");
	});

	it("keeps degraded diagnostics visible while preserving healthy drill-down links", async () => {
		mockGetAggregateOverview.mockResolvedValue({
			request_id: "req-kanban-2",
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
						request_id: "req-kanban-2",
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
		});

		renderWithRouter();

		await waitFor(() => {
			expect(screen.getByText("部分降级")).toBeInTheDocument();
		});

		expect(screen.getByText("OpenClaw upstream unavailable")).toBeInTheDocument();
		expect(screen.getByText("code · source_unavailable")).toBeInTheDocument();
		expect(screen.getByText("request_id · req-kanban-2")).toBeInTheDocument();
		expect(screen.getByText("recoverable · true")).toBeInTheDocument();
		expect(screen.getByText("检查实例连通性或网关 token 后重试")).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: /进入会话 - Healthy Agent/i }),
		).toHaveAttribute("href", "/session/instance-healthy/agent-healthy");
	});
});
