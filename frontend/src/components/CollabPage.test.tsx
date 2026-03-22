import { render, screen, waitFor, within } from "@testing-library/react";
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

	it("renders four kanban columns with correct headers when agents exist", async () => {
		mockGetAggregateOverview.mockResolvedValue({
			request_id: "req-kanban-1",
			freshness: {
				status: "fresh",
				checked_at: "2026-03-22T12:10:00Z",
			},
			partial_failure: false,
			diagnostics: [],
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

		expect(screen.getByRole("heading", { name: "需关注" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "进行中" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "待巡视" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "已完成" })).toBeInTheDocument();
	});

	it("groups agents into correct columns based on status", async () => {
		mockGetAggregateOverview.mockResolvedValue({
			request_id: "req-kanban-2",
			freshness: {
				status: "fresh",
				checked_at: "2026-03-22T12:10:00Z",
			},
			partial_failure: false,
			diagnostics: [],
			agents: [
				{
					instance_id: "instance-error",
					instance_name: "error-instance",
					agent_id: "agent-error",
					agent_name: "Error Agent",
					status: "error",
					is_active: false,
					last_active_at: "2026-03-22T12:00:00Z",
					drilldown_path: "/session/instance-error/agent-error",
				},
				{
					instance_id: "instance-running",
					instance_name: "running-instance",
					agent_id: "agent-running",
					agent_name: "Running Agent",
					status: "running",
					is_active: true,
					last_active_at: "2026-03-22T12:05:00Z",
					drilldown_path: "/session/instance-running/agent-running",
				},
				{
					instance_id: "instance-idle",
					instance_name: "idle-instance",
					agent_id: "agent-idle",
					agent_name: "Idle Agent",
					status: "idle",
					is_active: false,
					last_active_at: "2026-03-22T11:00:00Z",
					drilldown_path: "/session/instance-idle/agent-idle",
				},
				{
					instance_id: "instance-finished",
					instance_name: "finished-instance",
					agent_id: "agent-finished",
					agent_name: "Finished Agent",
					status: "finished",
					is_active: false,
					last_active_at: "2026-03-22T10:00:00Z",
					drilldown_path: "/session/instance-finished/agent-finished",
				},
			],
		});

		renderWithRouter();

		await waitFor(() => {
			expect(screen.getByText("Error Agent")).toBeInTheDocument();
		});

		expect(screen.getByText("Running Agent")).toBeInTheDocument();
		expect(screen.getByText("Idle Agent")).toBeInTheDocument();
		expect(screen.getByText("Finished Agent")).toBeInTheDocument();

		expect(screen.getByText("异常")).toBeInTheDocument();
		expect(screen.getByText("运行中")).toBeInTheDocument();
		expect(screen.getAllByText("待巡视").length).toBeGreaterThan(0);
		expect(screen.getAllByText("已完成").length).toBeGreaterThan(0);
	});

	it("renders cards with title, instance, status, and drill-down link", async () => {
		mockGetAggregateOverview.mockResolvedValue({
			request_id: "req-kanban-3",
			freshness: {
				status: "fresh",
				checked_at: "2026-03-22T12:10:00Z",
			},
			partial_failure: false,
			diagnostics: [],
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
			expect(screen.getByText("Alpha Agent")).toBeInTheDocument();
		});

		expect(screen.getByText("alpha-instance")).toBeInTheDocument();
		expect(screen.getByText("运行中")).toBeInTheDocument();
		expect(screen.getByText(/最近活动/)).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: /进入会话 - Alpha Agent/i }),
		).toHaveAttribute("href", "/session/instance-alpha/agent-alpha");
	});

	it("shows diagnostic alert on cards with failed instances", async () => {
		mockGetAggregateOverview.mockResolvedValue({
			request_id: "req-kanban-4",
			freshness: {
				status: "fresh",
				checked_at: "2026-03-22T12:10:00Z",
			},
			partial_failure: true,
			diagnostics: [
				{
					instance_id: "instance-failed",
					instance_name: "failed-instance",
					status: "failed",
					freshness: {
						status: "failed",
						checked_at: "2026-03-22T12:00:00Z",
					},
					error: {
						code: "source_unavailable",
						message: "OpenClaw upstream unavailable",
						request_id: "req-kanban-4",
						recoverable: true,
						next_step: "检查实例连通性",
					},
				},
			],
			agents: [
				{
					instance_id: "instance-failed",
					instance_name: "failed-instance",
					agent_id: "agent-failed",
					agent_name: "Failed Agent",
					status: "error",
					is_active: false,
					last_active_at: "2026-03-22T11:00:00Z",
					drilldown_path: "/session/instance-failed/agent-failed",
				},
			],
		});

		renderWithRouter();

		await waitFor(() => {
			expect(screen.getByText("Failed Agent")).toBeInTheDocument();
		});

		expect(screen.getByText("OpenClaw upstream unavailable")).toBeInTheDocument();
	});

	it("preserves canonical session drill-down for all agents", async () => {
		mockGetAggregateOverview.mockResolvedValue({
			request_id: "req-kanban-5",
			freshness: {
				status: "fresh",
				checked_at: "2026-03-22T12:10:00Z",
			},
			partial_failure: false,
			diagnostics: [],
			agents: [
				{
					instance_id: "inst-1",
					instance_name: "Instance One",
					agent_id: "ag-1",
					agent_name: "Agent One",
					status: "running",
					is_active: true,
					last_active_at: "2026-03-22T12:00:00Z",
					drilldown_path: "/session/inst-1/ag-1",
				},
				{
					instance_id: "inst-2",
					instance_name: "Instance Two",
					agent_id: "ag-2",
					agent_name: "Agent Two",
					status: "finished",
					is_active: false,
					last_active_at: "2026-03-22T11:00:00Z",
					drilldown_path: "/session/inst-2/ag-2",
				},
			],
		});

		renderWithRouter();

		await waitFor(() => {
			expect(screen.getByText("Agent One")).toBeInTheDocument();
		});

		const links = screen.getAllByRole("link", { name: /进入会话/ });
		expect(links).toHaveLength(2);
		expect(links[0]).toHaveAttribute("href", "/session/inst-1/ag-1");
		expect(links[1]).toHaveAttribute("href", "/session/inst-2/ag-2");
	});

	describe("kanban-board testid contract", () => {
		it("exposes kanban-board testid on the main board container", async () => {
			mockGetAggregateOverview.mockResolvedValue({
				request_id: "req-kanban-6",
				freshness: {
					status: "fresh",
					checked_at: "2026-03-22T12:15:00Z",
				},
				partial_failure: false,
				diagnostics: [],
				agents: [
					{
						instance_id: "instance-alpha",
						instance_name: "alpha-instance",
						agent_id: "agent-alpha",
						agent_name: "Alpha Agent",
						status: "running",
						is_active: true,
						last_active_at: "2026-03-22T12:10:00Z",
						drilldown_path: "/session/instance-alpha/agent-alpha",
					},
				],
			});

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByText("Alpha Agent")).toBeInTheDocument();
			});

			const kanbanBoard = screen.getByTestId("kanban-board");
			expect(kanbanBoard).toBeInTheDocument();
			expect(kanbanBoard).toHaveTextContent("Alpha Agent");
		});
	});

	describe("loading and error states", () => {
		it("shows loading state initially", () => {
			mockGetAggregateOverview.mockImplementation(() => new Promise(() => {}));

			renderWithRouter();

			expect(screen.getByText("加载中...")).toBeInTheDocument();
		});

		it("shows error state with retry button on failure", async () => {
			mockGetAggregateOverview.mockRejectedValue(new Error("网络错误"));

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByText("加载失败")).toBeInTheDocument();
			});

			expect(screen.getByText("网络错误")).toBeInTheDocument();
			expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
		});
	});

	describe("empty state", () => {
		it("shows empty state when no agents exist", async () => {
			mockGetAggregateOverview.mockResolvedValue({
				request_id: "req-kanban-7",
				freshness: {
					status: "fresh",
					checked_at: "2026-03-22T12:10:00Z",
				},
				partial_failure: false,
				diagnostics: [],
				agents: [],
			});

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByText("当前没有可观察的工作信号")).toBeInTheDocument();
			});

			expect(screen.getByRole("link", { name: "查看拓扑" })).toBeInTheDocument();
		});
	});

	describe("column counts", () => {
		it("shows correct counts in column badges", async () => {
			mockGetAggregateOverview.mockResolvedValue({
				request_id: "req-kanban-8",
				freshness: {
					status: "fresh",
					checked_at: "2026-03-22T12:10:00Z",
				},
				partial_failure: false,
				diagnostics: [],
				agents: [
					{
						instance_id: "inst-1",
						instance_name: "Instance One",
						agent_id: "ag-1",
						agent_name: "Agent One",
						status: "error",
						is_active: false,
						last_active_at: null,
						drilldown_path: "/session/inst-1/ag-1",
					},
					{
						instance_id: "inst-2",
						instance_name: "Instance Two",
						agent_id: "ag-2",
						agent_name: "Agent Two",
						status: "running",
						is_active: true,
						last_active_at: null,
						drilldown_path: "/session/inst-2/ag-2",
					},
					{
						instance_id: "inst-3",
						instance_name: "Instance Three",
						agent_id: "ag-3",
						agent_name: "Agent Three",
						status: "idle",
						is_active: false,
						last_active_at: null,
						drilldown_path: "/session/inst-3/ag-3",
					},
				],
			});

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByText("Agent One")).toBeInTheDocument();
			});

			const badges = screen.getAllByText(/\d/);
			expect(badges.length).toBeGreaterThan(0);
		});
	});

	describe("diagnostics priority in column assignment", () => {
		it("prioritizes diagnostics failure over running status", async () => {
			mockGetAggregateOverview.mockResolvedValue({
				request_id: "req-diag-priority-1",
				freshness: {
					status: "stale",
					checked_at: "2026-03-22T14:00:00Z",
				},
				partial_failure: true,
				diagnostics: [
					{
						instance_id: "instance-running-but-failed",
						instance_name: "running-but-failed-instance",
						status: "failed",
						freshness: {
							status: "failed",
							checked_at: "2026-03-22T13:55:00Z",
						},
						error: {
							code: "source_unavailable",
							message: "Upstream connection lost",
							request_id: "req-diag-priority-1",
							recoverable: true,
							next_step: "Check network connectivity",
						},
					},
				],
				agents: [
					{
						instance_id: "instance-running-but-failed",
						instance_name: "running-but-failed-instance",
						agent_id: "agent-running-but-failed",
						agent_name: "Running But Failed Agent",
						status: "running",
						is_active: true,
						last_active_at: "2026-03-22T14:00:00Z",
						drilldown_path: "/session/instance-running-but-failed/agent-running-but-failed",
					},
				],
			});

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByText("Running But Failed Agent")).toBeInTheDocument();
			});

			const needsAttentionColumn = screen.getByTestId("kanban-board").querySelector('[data-column-key="needs_attention"]');
			expect(within(needsAttentionColumn as HTMLElement).getByText("Running But Failed Agent")).toBeInTheDocument();

			const inProgressColumn = screen.getByTestId("kanban-board").querySelector('[data-column-key="in_progress"]');
			expect(within(inProgressColumn as HTMLElement).queryByText("Running But Failed Agent")).not.toBeInTheDocument();
		});

		it("prioritizes diagnostics failure over finished status", async () => {
			mockGetAggregateOverview.mockResolvedValue({
				request_id: "req-diag-priority-2",
				freshness: {
					status: "stale",
					checked_at: "2026-03-22T14:00:00Z",
				},
				partial_failure: true,
				diagnostics: [
					{
						instance_id: "instance-finished-but-failed",
						instance_name: "finished-but-failed-instance",
						status: "failed",
						freshness: {
							status: "failed",
							checked_at: "2026-03-22T13:50:00Z",
						},
						error: {
							code: "timeout",
							message: "Instance health check timed out",
							request_id: "req-diag-priority-2",
							recoverable: false,
							next_step: null,
						},
					},
				],
				agents: [
					{
						instance_id: "instance-finished-but-failed",
						instance_name: "finished-but-failed-instance",
						agent_id: "agent-finished-but-failed",
						agent_name: "Finished But Failed Agent",
						status: "finished",
						is_active: false,
						last_active_at: "2026-03-22T13:45:00Z",
						drilldown_path: "/session/instance-finished-but-failed/agent-finished-but-failed",
					},
				],
			});

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByText("Finished But Failed Agent")).toBeInTheDocument();
			});

			const needsAttentionColumn = screen.getByTestId("kanban-board").querySelector('[data-column-key="needs_attention"]');
			expect(within(needsAttentionColumn as HTMLElement).getByText("Finished But Failed Agent")).toBeInTheDocument();

			const completedColumn = screen.getByTestId("kanban-board").querySelector('[data-column-key="completed"]');
			expect(within(completedColumn as HTMLElement).queryByText("Finished But Failed Agent")).not.toBeInTheDocument();
		});

		it("places running agent in in_progress when no diagnostic failure", async () => {
			mockGetAggregateOverview.mockResolvedValue({
				request_id: "req-diag-priority-3",
				freshness: {
					status: "fresh",
					checked_at: "2026-03-22T14:00:00Z",
				},
				partial_failure: false,
				diagnostics: [
					{
						instance_id: "instance-healthy",
						instance_name: "healthy-instance",
						status: "healthy",
						freshness: {
							status: "fresh",
							checked_at: "2026-03-22T13:59:00Z",
						},
					},
				],
				agents: [
					{
						instance_id: "instance-healthy",
						instance_name: "healthy-instance",
						agent_id: "agent-healthy",
						agent_name: "Healthy Running Agent",
						status: "running",
						is_active: true,
						last_active_at: "2026-03-22T14:00:00Z",
						drilldown_path: "/session/instance-healthy/agent-healthy",
					},
				],
			});

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByText("Healthy Running Agent")).toBeInTheDocument();
			});

			const inProgressColumn = screen.getByTestId("kanban-board").querySelector('[data-column-key="in_progress"]');
			expect(within(inProgressColumn as HTMLElement).getByText("Healthy Running Agent")).toBeInTheDocument();

			const needsAttentionColumn = screen.getByTestId("kanban-board").querySelector('[data-column-key="needs_attention"]');
			expect(within(needsAttentionColumn as HTMLElement).queryByText("Healthy Running Agent")).not.toBeInTheDocument();
		});

		it("places finished agent in completed when no diagnostic failure", async () => {
			mockGetAggregateOverview.mockResolvedValue({
				request_id: "req-diag-priority-4",
				freshness: {
					status: "fresh",
					checked_at: "2026-03-22T14:00:00Z",
				},
				partial_failure: false,
				diagnostics: [
					{
						instance_id: "instance-done",
						instance_name: "done-instance",
						status: "healthy",
						freshness: {
							status: "fresh",
							checked_at: "2026-03-22T13:58:00Z",
						},
					},
				],
				agents: [
					{
						instance_id: "instance-done",
						instance_name: "done-instance",
						agent_id: "agent-done",
						agent_name: "Done Agent",
						status: "finished",
						is_active: false,
						last_active_at: "2026-03-22T13:55:00Z",
						drilldown_path: "/session/instance-done/agent-done",
					},
				],
			});

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByText("Done Agent")).toBeInTheDocument();
			});

			const completedColumn = screen.getByTestId("kanban-board").querySelector('[data-column-key="completed"]');
			expect(within(completedColumn as HTMLElement).getByText("Done Agent")).toBeInTheDocument();

			const needsAttentionColumn = screen.getByTestId("kanban-board").querySelector('[data-column-key="needs_attention"]');
			expect(within(needsAttentionColumn as HTMLElement).queryByText("Done Agent")).not.toBeInTheDocument();
		});
	});
});