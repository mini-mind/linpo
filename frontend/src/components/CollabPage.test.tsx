import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";

import type {
	AggregateInstanceDiagnostic,
	AggregateOverviewAgentItem,
	AggregateOverviewResponse,
} from "../api/types";
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

function buildAgent(
	overrides: Partial<AggregateOverviewAgentItem> = {},
): AggregateOverviewAgentItem {
	return {
		instance_id: "instance-alpha",
		instance_name: "alpha-instance",
		agent_id: "agent-alpha",
		agent_name: "Alpha Agent",
		status: "running",
		is_active: true,
		last_active_at: "2026-03-22T12:08:00Z",
		drilldown_path: "/session/agent-alpha/__none__/__new__?instanceId=instance-alpha",
		...overrides,
	};
}

function buildDiagnostic(
	overrides: Partial<AggregateInstanceDiagnostic> = {},
): AggregateInstanceDiagnostic {
	return {
		instance_id: "instance-alpha",
		instance_name: "alpha-instance",
		status: "ok",
		freshness: {
			status: "fresh",
			checked_at: "2026-03-22T12:10:00Z",
		},
		error: null,
		...overrides,
	};
}

function buildOverview(
	overrides: Partial<AggregateOverviewResponse> = {},
): AggregateOverviewResponse {
	return {
		request_id: "req-kanban",
		freshness: {
			status: "fresh",
			checked_at: "2026-03-22T12:10:00Z",
		},
		partial_failure: false,
		diagnostics: [],
		agents: [],
		stats: {
			instance_count: 0,
			agent_count: 0,
			active_agent_count: 0,
			attention_instance_count: 0,
			total_tokens: null,
		},
		token_groups: [],
		global_events: [],
		...overrides,
	};
}

function renderWithRouter(): ReturnType<typeof render> {
	return render(
		<MemoryRouter initialEntries={["/kanban"]}>
			<CollabPage />
		</MemoryRouter>,
	);
}

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

describe("CollabPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders kanban board with columns", async () => {
		mockGetAggregateOverview.mockResolvedValue(
			buildOverview({
				agents: [buildAgent()],
			}),
		);

		renderWithRouter();

		await waitFor(() => {
			expect(screen.getByTestId("kanban-board")).toBeInTheDocument();
		});

		expect(screen.getByRole("heading", { name: "待处理" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "推进中" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "待确认" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "已收尾" })).toBeInTheDocument();
	});

	it("renders task cards with intent, ownership context and an explicit action row", async () => {
		mockGetAggregateOverview.mockResolvedValue(
			buildOverview({
				agents: [
					buildAgent({
						agent_name: "Running Agent",
						instance_id: "instance-running",
						instance_name: "running-instance",
						agent_id: "agent-running",
						drilldown_path:
							"/session/agent-running/__none__/__new__?instanceId=instance-running",
					}),
					buildAgent({
						agent_name: "Finished Agent",
						instance_id: "instance-finished",
						instance_name: "finished-instance",
						agent_id: "agent-finished",
						status: "finished",
						is_active: false,
						drilldown_path:
							"/session/agent-finished/__none__/__new__?instanceId=instance-finished",
					}),
				],
			}),
		);

		renderWithRouter();

		await waitFor(() => {
			expect(
				screen.getByRole("heading", { name: "推进 Running Agent 当前任务" }),
			).toBeInTheDocument();
		});

		expect(
			screen.getByRole("heading", { name: "复盘 Finished Agent 最近交付" }),
		).toBeInTheDocument();
		expect(screen.queryByRole("heading", { name: "Running Agent" })).not.toBeInTheDocument();
		expect(screen.getAllByText("任务意图")).toHaveLength(2);
		expect(screen.getByText("责任主体 · Running Agent")).toBeInTheDocument();
		expect(screen.getByText("责任主体 · Finished Agent")).toBeInTheDocument();
		expect(screen.getByText("实例上下文 · running-instance")).toBeInTheDocument();
		expect(screen.getByText("实例上下文 · finished-instance")).toBeInTheDocument();
		expect(screen.getAllByText("来源 · overview 聚合")).toHaveLength(2);
		expect(screen.getAllByText("可用动作")).toHaveLength(2);
		expect(screen.getAllByRole("button", { name: "进入任务上下文" })).toHaveLength(2);

		const sessionWorkspaceLinks = screen.getAllByRole("link", {
			name: "进入 session 工作区",
		});
		expect(sessionWorkspaceLinks[0]).toHaveAttribute(
			"href",
			"/session/agent-running/__none__/__new__?instanceId=instance-running",
		);
		expect(sessionWorkspaceLinks[1]).toHaveAttribute(
			"href",
			"/session/agent-finished/__none__/__new__?instanceId=instance-finished",
		);
	});

	it("keeps task context entry separate from session workspace jump", async () => {
		mockGetAggregateOverview.mockResolvedValue(
			buildOverview({
				agents: [
					buildAgent({
						agent_name: "Context Agent",
						instance_id: "instance-context",
						instance_name: "context-instance",
						agent_id: "agent-context",
						drilldown_path:
							"/session/agent-context/__none__/__new__?instanceId=instance-context",
					}),
				],
			}),
		);

		renderWithRouter();

		await waitFor(() => {
			expect(
				screen.getByRole("heading", { name: "推进 Context Agent 当前任务" }),
			).toBeInTheDocument();
		});

		expect(screen.queryByText("任务上下文锚点")).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "进入任务上下文" }));

		expect(screen.getByText("任务上下文锚点")).toBeInTheDocument();
		expect(
			screen.getByText("先确认为什么是这张任务卡，再决定是否跳转到 session 工作区继续推进。"),
		).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: "进入 session 工作区" }),
		).toHaveAttribute(
			"href",
			"/session/agent-context/__none__/__new__?instanceId=instance-context",
		);
	});

	it("shows disabled session fallback when task card lacks a valid session entry path", async () => {
		mockGetAggregateOverview.mockResolvedValue(
			buildOverview({
				agents: [
					buildAgent({
						agent_name: "Fallback Agent",
						instance_id: "instance-fallback",
						instance_name: "fallback-instance",
						agent_id: "agent-fallback",
						drilldown_path: "",
					}),
				],
			}),
		);

		renderWithRouter();

		await waitFor(() => {
			expect(
				screen.getByRole("heading", { name: "推进 Fallback Agent 当前任务" }),
			).toBeInTheDocument();
		});

		const sessionEntryButton = screen.getByRole("button", {
			name: "进入 session 工作区",
		});
		expect(sessionEntryButton).toBeDisabled();
		expect(screen.queryByRole("link", { name: "进入 session 工作区" })).not.toBeInTheDocument();
		expect(
			screen.getByText("需先在 topology / team / session 确认可用会话入口"),
		).toBeInTheDocument();
	});

	it("prioritizes failed diagnostics into attention tasks instead of active signal cards", async () => {
		mockGetAggregateOverview.mockResolvedValue(
			buildOverview({
				partial_failure: true,
				diagnostics: [
					buildDiagnostic({
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
							request_id: "req-kanban-diag",
							recoverable: true,
							next_step: "检查实例连通性",
						},
					}),
				],
				agents: [
					buildAgent({
						instance_id: "instance-failed",
						instance_name: "failed-instance",
						agent_id: "agent-failed",
						agent_name: "Failed Agent",
						status: "running",
						is_active: true,
						drilldown_path:
							"/session/agent-failed/__none__/__new__?instanceId=instance-failed",
					}),
				],
			}),
		);

		renderWithRouter();

		await waitFor(() => {
			expect(
				screen.getByRole("heading", { name: "处理 Failed Agent 的异常阻塞" }),
			).toBeInTheDocument();
		});

		const needsAttentionColumn = screen
			.getByTestId("kanban-board")
			.querySelector('[data-column-key="needs_attention"]');
		expect(needsAttentionColumn).not.toBeNull();
		expect(
			within(needsAttentionColumn as HTMLElement).getByRole("heading", {
				name: "处理 Failed Agent 的异常阻塞",
			}),
		).toBeInTheDocument();
		expect(
			within(needsAttentionColumn as HTMLElement).getByText("OpenClaw upstream unavailable"),
		).toBeInTheDocument();
		expect(
			within(needsAttentionColumn as HTMLElement).getByRole("link", {
				name: "进入 session 工作区",
			}),
		).toHaveAttribute(
			"href",
			"/session/agent-failed/__none__/__new__?instanceId=instance-failed",
		);

		const inProgressColumn = screen
			.getByTestId("kanban-board")
			.querySelector('[data-column-key="in_progress"]');
		expect(inProgressColumn).not.toBeNull();
		expect(
			within(inProgressColumn as HTMLElement).queryByRole("heading", {
				name: "处理 Failed Agent 的异常阻塞",
			}),
		).not.toBeInTheDocument();
	});

	it("keeps the main board container contract stable", async () => {
		mockGetAggregateOverview.mockResolvedValue(
			buildOverview({
				agents: [buildAgent({ agent_name: "Stable Agent" })],
			}),
		);

		renderWithRouter();

		await waitFor(() => {
			expect(
				screen.getByRole("heading", { name: "推进 Stable Agent 当前任务" }),
			).toBeInTheDocument();
		});

		const kanbanBoard = screen.getByTestId("kanban-board");
		expect(kanbanBoard).toBeInTheDocument();
		expect(kanbanBoard).toHaveTextContent("推进 Stable Agent 当前任务");
	});

	it("shows kanban board with partial failure data", async () => {
		mockGetAggregateOverview.mockResolvedValue(
			buildOverview({
				partial_failure: true,
				diagnostics: [
					buildDiagnostic(),
					buildDiagnostic({
						instance_id: "instance-failed",
						instance_name: "failed-instance",
						status: "failed",
						freshness: {
							status: "failed",
							checked_at: "2026-03-22T11:45:00Z",
						},
						error: {
							code: "source_unavailable",
							message: "OpenClaw upstream unavailable",
							request_id: "req-kanban-diag",
							recoverable: true,
							next_step: "检查实例连通性",
						},
					}),
				],
				agents: [buildAgent()],
			}),
		);

		renderWithRouter();

		await waitFor(() => {
			expect(screen.getByTestId("kanban-board")).toBeInTheDocument();
		});

		expect(screen.getByTestId("kanban-board")).toHaveTextContent(
			"推进 Alpha Agent 当前任务",
		);
	});

	it("re-reads aggregate overview when refresh is triggered", async () => {
		mockGetAggregateOverview
			.mockResolvedValueOnce(
				buildOverview({
					agents: [buildAgent()],
				}),
			)
			.mockResolvedValueOnce(
				buildOverview({
					agents: [buildAgent()],
				}),
			);

		renderWithRouter();

		await waitFor(() => {
			expect(screen.getByTestId("kanban-board")).toBeInTheDocument();
		});

		expect(mockGetAggregateOverview).toHaveBeenCalledTimes(1);
	});

	describe("loading and error states", () => {
		it("keeps the board shell visible while aggregate overview is loading", () => {
			const deferred = createDeferredPromise<AggregateOverviewResponse>();
			mockGetAggregateOverview.mockReturnValue(deferred.promise);

			renderWithRouter();

			expect(screen.getByTestId("kanban-board")).toBeInTheDocument();
			expect(screen.getByRole("heading", { name: "待处理" })).toBeInTheDocument();
			expect(screen.getByRole("heading", { name: "推进中" })).toBeInTheDocument();
		});

		it("shows a readable failed state with retry", async () => {
			mockGetAggregateOverview.mockRejectedValue(
				new ApiError(503, "OpenClaw upstream unavailable", {
					code: "source_unavailable",
					message: "OpenClaw upstream unavailable",
					request_id: "req-kanban-503",
					recoverable: true,
					next_step: "检查实例连通性后重试",
				}),
			);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByText("任务板加载失败")).toBeInTheDocument();
			});

			expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
		});

		it("shows error state for unauthorized access", async () => {
			mockGetAggregateOverview.mockRejectedValue(
				new ApiError(401, "Unauthorized", {
					code: "unauthorized",
					message: "Unauthorized",
					request_id: "req-kanban-401",
					recoverable: true,
					next_step: "重新登录后重试",
				}),
			);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByText("任务板加载失败")).toBeInTheDocument();
			});

			expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
		});

		it("re-reads aggregate overview when retry is triggered from the failed state", async () => {
			mockGetAggregateOverview
				.mockRejectedValueOnce(
					new ApiError(503, "OpenClaw upstream unavailable", {
						code: "source_unavailable",
						message: "OpenClaw upstream unavailable",
						request_id: "req-kanban-503",
						recoverable: true,
						next_step: "检查实例连通性后重试",
					}),
				)
				.mockResolvedValueOnce(
					buildOverview({
						agents: [buildAgent()],
					}),
				);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
			});

			fireEvent.click(screen.getByRole("button", { name: "重试" }));

			await waitFor(() => {
				expect(screen.getByTestId("kanban-board")).toBeInTheDocument();
			});

			expect(mockGetAggregateOverview).toHaveBeenCalledTimes(2);
		});
	});

	it("shows empty state when no tasks can be derived", async () => {
		mockGetAggregateOverview.mockResolvedValue(buildOverview());

		renderWithRouter();

		await waitFor(() => {
			expect(screen.getByText("当前还没有可派生的任务卡")).toBeInTheDocument();
		});

		expect(screen.getByRole("link", { name: "去 topology 核对入口" })).toBeInTheDocument();
	});

	it("shows kanban board with stale data", async () => {
		mockGetAggregateOverview.mockResolvedValue(
			buildOverview({
				freshness: {
					status: "stale",
					checked_at: "2026-03-22T11:40:00Z",
				},
				agents: [buildAgent()],
			}),
		);

		renderWithRouter();

		await waitFor(() => {
			expect(screen.getByTestId("kanban-board")).toBeInTheDocument();
		});

		expect(screen.getByTestId("kanban-board")).toHaveTextContent(
			"推进 Alpha Agent 当前任务",
		);
	});
});
