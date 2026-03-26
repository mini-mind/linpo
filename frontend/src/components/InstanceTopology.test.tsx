import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { buildSessionEntryPath } from "./SessionPage";

const mockGetAggregateTopology = vi.fn();

vi.mock("../api/client", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../api/client")>();
	return {
		...actual,
		getAggregateTopology: (...args: unknown[]) => mockGetAggregateTopology(...args),
	};
});

vi.mock("../hooks/useIsMobile", () => ({
	useIsMobile: () => false,
}));

vi.mock("../api/realtimeClient", () => ({
	createObserverRealtimeClient: () => ({
		connect: vi.fn(),
		close: vi.fn(),
	}),
}));

import { InstanceTopology } from "./InstanceTopology";

const aggregateTopologyFixture = {
	request_id: "req-topology-1",
	freshness: {
		status: "fresh",
		checked_at: "2026-03-22T12:05:00Z",
	},
	partial_failure: false,
	diagnostics: [
		{
			instance_id: "instance-alpha",
			instance_name: "alpha-instance",
			status: "ok",
			freshness: {
				status: "fresh",
				checked_at: "2026-03-22T12:05:00Z",
			},
			error: null,
		},
		{
			instance_id: "instance-empty",
			instance_name: "empty-instance",
			status: "failed",
			freshness: {
				status: "stale",
				checked_at: "2026-03-22T11:20:00Z",
			},
			error: {
				code: "source_unavailable",
				message: "OpenClaw upstream unavailable",
				request_id: "req-topology-1",
				recoverable: true,
				next_step: "检查实例连通性或网关 token 后重试",
			},
		},
	],
	instances: [
		{
			node_id: "instance:instance-alpha",
			instance_id: "instance-alpha",
			name: "alpha-instance",
			type: "openclaw",
			status: "active",
			last_check_at: "2026-03-22T12:05:00Z",
			created_at: "2026-03-22T08:00:00Z",
		},
		{
			node_id: "instance:instance-empty",
			instance_id: "instance-empty",
			name: "empty-instance",
			type: "openclaw",
			status: "inactive",
			last_check_at: "2026-03-22T11:20:00Z",
			created_at: "2026-03-22T09:10:00Z",
		},
	],
		agents: [
			{
				node_id: "agent:instance-alpha:agent-alpha",
			instance_id: "instance-alpha",
			instance_name: "alpha-instance",
			agent_id: "agent-alpha",
			agent_name: "Alpha Agent",
			status: "running",
			is_active: true,
			last_active_at: "2026-03-22T12:00:00Z",
				drilldown_path:
					"/session/agent-alpha/__none__/__new__?instanceId=instance-alpha",
			},
		],
	sessions: [
		{
			node_id: "session:instance-alpha:agent-alpha:agent:agent-alpha:main",
			instance_id: "instance-alpha",
			instance_name: "alpha-instance",
			agent_id: "agent-alpha",
			agent_name: "Alpha Agent",
			session_key: "agent:agent-alpha:main",
			label: "agent:agent-alpha:main",
			updated_at: "2026-03-22T12:02:00Z",
		},
	],
	tools: [],
	edges: [
		{
			source: "instance:instance-alpha",
			target: "agent:instance-alpha:agent-alpha",
			kind: "instance_agent",
		},
		{
			source: "agent:instance-alpha:agent-alpha",
			target: "session:instance-alpha:agent-alpha:agent:agent-alpha:main",
			kind: "agent_session",
		},
	],
};

const topologyWithTools = {
	...aggregateTopologyFixture,
	tools: [
		{
			node_id: "tool:instance-alpha:agent-alpha:read",
			instance_id: "instance-alpha",
			instance_name: "alpha-instance",
			agent_id: "agent-alpha",
			agent_name: "Alpha Agent",
			tool_id: "read",
			name: "read",
		},
		{
			node_id: "tool:instance-empty::orphan",
			instance_id: "instance-empty",
			instance_name: "empty-instance",
			agent_id: "",
			agent_name: "",
			tool_id: "orphan",
			name: "orphan",
		},
	],
	edges: [
		{
			source: "instance:instance-alpha",
			target: "agent:instance-alpha:agent-alpha",
			kind: "instance_agent",
		},
		{
			source: "agent:instance-alpha:agent-alpha",
			target: "session:instance-alpha:agent-alpha:agent:agent-alpha:main",
			kind: "agent_session",
		},
		{
			source: "agent:instance-alpha:agent-alpha",
			target: "tool:instance-alpha:agent-alpha:read",
			kind: "agent_tool",
		},
	],
};

const topologyWithUnavailableNodeContext = {
	...aggregateTopologyFixture,
	agents: [
		...aggregateTopologyFixture.agents,
		{
			node_id: "agent:instance-empty:",
			instance_id: "instance-empty",
			instance_name: "empty-instance",
			agent_id: "",
			agent_name: "Detached Agent",
			status: "idle",
			is_active: false,
			last_active_at: null,
			drilldown_path: "",
		},
	],
	sessions: [
		...aggregateTopologyFixture.sessions,
		{
			node_id: "session:instance-alpha:agent-alpha:missing",
			instance_id: "instance-alpha",
			instance_name: "alpha-instance",
			agent_id: "agent-alpha",
			agent_name: "Alpha Agent",
			session_key: "",
			label: "missing-session-key",
			updated_at: "2026-03-22T12:03:00Z",
		},
	],
};

function renderWithRouter(): ReturnType<typeof render> {
	return render(
		<MemoryRouter initialEntries={["/topology"]}>
			<InstanceTopology />
		</MemoryRouter>,
	);
}

function getTopologyControlToggleButton(): HTMLButtonElement | null {
	const toggles = screen.queryAllByRole("button").filter((button) => {
		const name =
			button.getAttribute("aria-label")?.trim() ?? button.textContent?.trim() ?? "";
		return /(菜单|操作|控制|更多|展开)/.test(name);
	});
	return (toggles[0] as HTMLButtonElement | undefined) ?? null;
}

async function ensureTopologyControlVisible(name: RegExp): Promise<HTMLButtonElement> {
	const directButton = screen.queryByRole("button", { name });
	if (directButton) {
		return directButton as HTMLButtonElement;
	}

	const toggleButton = getTopologyControlToggleButton();
	if (toggleButton) {
		fireEvent.click(toggleButton);
	}

	await waitFor(() => {
		expect(screen.getByRole("button", { name })).toBeInTheDocument();
	});

	return screen.getByRole("button", { name }) as HTMLButtonElement;
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

describe("InstanceTopology", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		window.localStorage.clear();
	});

	describe("graph canvas structure", () => {
		it("exposes a full-stage routing graph shell around the main canvas", async () => {
			mockGetAggregateTopology.mockResolvedValue(aggregateTopologyFixture);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByTestId("topology-graph-canvas")).toBeInTheDocument();
			});
		});

		it("keeps topology as a single routing stage without sidebar or detail panels", async () => {
			mockGetAggregateTopology.mockResolvedValue(aggregateTopologyFixture);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByTestId("topology-graph-canvas")).toBeInTheDocument();
			});

			expect(screen.queryByTestId("topology-sidebar")).not.toBeInTheDocument();
			expect(screen.queryByTestId("topology-detail-panel")).not.toBeInTheDocument();
			expect(screen.queryByTestId("topology-config-panel")).not.toBeInTheDocument();
		});
	});

	describe("node rendering", () => {
		it("renders instance nodes with correct testid", async () => {
			mockGetAggregateTopology.mockResolvedValue(aggregateTopologyFixture);

			renderWithRouter();

			await waitFor(() => {
				expect(
					screen.getByTestId("topology-node-instance-instance-alpha"),
				).toBeInTheDocument();
			});

			expect(
				screen.getByTestId("topology-node-instance-instance-empty"),
			).toBeInTheDocument();
			expect(
				within(
					screen.getByTestId("topology-node-instance-instance-alpha"),
				).getByText("alpha-instance"),
			).toBeInTheDocument();
			expect(
				within(
					screen.getByTestId("topology-node-instance-instance-empty"),
				).getByText("empty-instance"),
			).toBeInTheDocument();
		});

		it("shows explicit session entry rules for agent and session nodes", async () => {
			mockGetAggregateTopology.mockResolvedValue(aggregateTopologyFixture);

			renderWithRouter();

			await waitFor(() => {
				expect(
					screen.getByTestId("topology-node-agent-agent-alpha"),
				).toBeInTheDocument();
			});

			const agentNode = screen.getByTestId("topology-node-agent-agent-alpha");
			const sessionNode = screen.getByTestId(
				"topology-node-session-agent:agent-alpha:main",
			);

			const agentEntryLink = within(agentNode).getByTestId(
				"drilldown-link-agent-alpha",
			);
			expect(agentEntryLink).toHaveTextContent("进入默认会话");
			expect(agentEntryLink).toHaveAttribute(
				"href",
				buildSessionEntryPath({
					instanceId: "instance-alpha",
					agentId: "agent-alpha",
				}),
			);
			expect(within(agentNode).getByText("可进入")).toBeInTheDocument();
			expect(within(agentNode).getByText("默认会话")).toBeInTheDocument();

			const sessionEntryLink = within(sessionNode).getByRole("link", {
				name: "进入对应会话",
			});
			expect(sessionEntryLink).toHaveAttribute(
				"href",
				buildSessionEntryPath({
					instanceId: "instance-alpha",
					agentId: "agent-alpha",
					preferredSessionKey: "agent:agent-alpha:main",
				}),
			);
			expect(within(sessionNode).getByText("精确会话")).toBeInTheDocument();
			expect(within(agentNode).getByText("Alpha Agent")).toBeInTheDocument();
			expect(
				within(sessionNode).getByText("会话"),
			).toBeInTheDocument();
		});

		it("renders session nodes when sessions exist", async () => {
			mockGetAggregateTopology.mockResolvedValue(aggregateTopologyFixture);

			renderWithRouter();

			await waitFor(() => {
				expect(
					screen.getByTestId("topology-node-session-agent:agent-alpha:main"),
				).toBeInTheDocument();
			});

			expect(
				screen.getByTestId("topology-node-session-agent:agent-alpha:main"),
			).toBeInTheDocument();
		});

		it("shows fallback and disabled rules for tool and instance nodes", async () => {
			mockGetAggregateTopology.mockResolvedValue(topologyWithTools);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByTestId("topology-node-tool-read")).toBeInTheDocument();
			});
			const toolNode = screen.getByTestId("topology-node-tool-read");
			const orphanToolNode = screen.getByTestId("topology-node-tool-orphan");
			const instanceNode = screen.getByTestId("topology-node-instance-instance-alpha");

			const toolFallbackLink = screen.getByRole("link", {
				name: "回退到所属智能体",
			});
			expect(toolFallbackLink).toHaveAttribute(
				"href",
				buildSessionEntryPath({
					instanceId: "instance-alpha",
					agentId: "agent-alpha",
				}),
			);
			expect(
				within(toolNode).getByText("回退入口"),
			).toBeInTheDocument();
			expect(
				within(instanceNode).getByText("实例节点不提供会话入口"),
			).toBeInTheDocument();
			expect(
				within(orphanToolNode).getByText("缺少可回退上下文"),
			).toBeInTheDocument();
			expect(within(toolNode).getAllByText("read").length).toBeGreaterThan(0);
			expect(within(orphanToolNode).getAllByText("orphan").length).toBeGreaterThan(0);
			expect(within(instanceNode).getByText("alpha-instance")).toBeInTheDocument();
			expect(
				screen.queryByRole("link", { name: "进入实例会话" }),
			).not.toBeInTheDocument();
		});

		it("opens node popups via click and shows different details by node type", async () => {
			mockGetAggregateTopology.mockResolvedValue(topologyWithTools);

			renderWithRouter();

			await waitFor(() => {
				expect(
					screen.getByTestId("topology-node-instance-instance-alpha"),
				).toBeInTheDocument();
			});

			const instanceNode = screen.getByTestId("topology-node-instance-instance-alpha");
			const agentNode = screen.getByTestId("topology-node-agent-agent-alpha");
			const toolNode = screen.getByTestId("topology-node-tool-read");

			fireEvent.click(instanceNode);
			expect(within(instanceNode).getByText("实例节点不提供会话入口")).toBeInTheDocument();
			expect(
				within(instanceNode).queryByRole("link", { name: "进入默认会话" }),
			).not.toBeInTheDocument();

			fireEvent.click(agentNode);
			expect(within(agentNode).getByText("默认会话")).toBeInTheDocument();
			expect(within(agentNode).getByTestId("drilldown-link-agent-alpha")).toHaveTextContent(
				"进入默认会话",
			);

			fireEvent.click(toolNode);
			expect(within(toolNode).getByText("回退入口")).toBeInTheDocument();
			expect(within(toolNode).getByRole("link", { name: "回退到所属智能体" })).toHaveAttribute(
				"href",
				buildSessionEntryPath({
					instanceId: "instance-alpha",
					agentId: "agent-alpha",
				}),
			);
		});

		it("disables agent and session nodes when required context is missing", async () => {
			mockGetAggregateTopology.mockResolvedValue(topologyWithUnavailableNodeContext);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByTestId("topology-node-agent-")).toBeInTheDocument();
			});
			const detachedAgentNode = screen.getByTestId("topology-node-agent-");
			const missingSessionNode = screen.getByTestId("topology-node-session-");

			expect(within(detachedAgentNode).getByText("Detached Agent")).toBeInTheDocument();
			expect(
				within(missingSessionNode).getByText("会话"),
			).toBeInTheDocument();
			expect(
				within(detachedAgentNode).getByText("缺少进入上下文"),
			).toBeInTheDocument();
			expect(
				within(missingSessionNode).getByText("缺少 session key"),
			).toBeInTheDocument();
		});

		it("does not render legacy skill or ACP nodes", async () => {
			mockGetAggregateTopology.mockResolvedValue(aggregateTopologyFixture);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByTestId("topology-graph-canvas")).toBeInTheDocument();
			});

			expect(screen.queryByText("SKILL")).not.toBeInTheDocument();
			expect(screen.queryByText("ACP")).not.toBeInTheDocument();
			expect(screen.queryByTestId("topology-node-skill-Code Analysis")).not.toBeInTheDocument();
			expect(screen.queryByTestId("topology-node-acp-External API")).not.toBeInTheDocument();
		});
	});

	describe("loading and error states", () => {
		it("keeps the topology canvas visible while aggregate topology is loading", () => {
			const deferred = createDeferredPromise<typeof aggregateTopologyFixture>();
			mockGetAggregateTopology.mockReturnValue(deferred.promise);

			renderWithRouter();

			expect(screen.getByTestId("topology-graph-canvas")).toBeInTheDocument();
			expect(screen.getByText("加载拓扑数据...")).toBeInTheDocument();
		});

		it("keeps the topology canvas and shows an explicit empty state when the aggregate payload has no graph data", async () => {
			mockGetAggregateTopology.mockResolvedValue({
				...aggregateTopologyFixture,
				request_id: "req-topology-empty",
				diagnostics: [],
				instances: [],
				agents: [],
				sessions: [],
				tools: [],
				edges: [],
			});

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByTestId("topology-graph-canvas")).toBeInTheDocument();
			});

			expect(screen.getByTestId("topology-graph-canvas")).toHaveTextContent(
				"当前没有可展示的拓扑关系",
			);
		});

		it("keeps successful topology content visible with nodes rendered", async () => {
			mockGetAggregateTopology.mockResolvedValue({
				...aggregateTopologyFixture,
				partial_failure: false,
			});

			renderWithRouter();

			await waitFor(() => {
				expect(
					screen.getByTestId("topology-node-instance-instance-alpha"),
				).toBeInTheDocument();
			});
		});

		it("surfaces aggregate request failures with error envelope", async () => {
			mockGetAggregateTopology.mockRejectedValue(
				new ApiError(503, "OpenClaw upstream unavailable", {
					code: "source_unavailable",
					message: "OpenClaw upstream unavailable",
					request_id: "req-topology-503",
					recoverable: true,
					next_step: "检查实例连通性或网关 token 后重试",
				}),
			);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByText("code · source_unavailable")).toBeInTheDocument();
			});

			const graphCanvas = screen.getByTestId("topology-graph-canvas");
			expect(screen.getByText("拓扑暂时不可用")).toBeInTheDocument();
			expect(
				screen.getByText(/错误: OpenClaw upstream unavailable/i),
			).toBeInTheDocument();
			expect(within(graphCanvas).getByText("request_id · req-topology-503")).toBeInTheDocument();
			expect(screen.getByText("recoverable · true")).toBeInTheDocument();
			expect(
				screen.getByText("检查实例连通性或网关 token 后重试"),
			).toBeInTheDocument();
		});

		it("provides retry button on error", async () => {
			mockGetAggregateTopology.mockRejectedValueOnce(
				new ApiError(503, "Temporary error", {
					code: "internal_error",
					message: "Temporary error",
					request_id: "req-1",
					recoverable: true,
					next_step: null,
				}),
			);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
			});
		});

		it("shows an explicit unauthorized state instead of a generic failed state", async () => {
			mockGetAggregateTopology.mockRejectedValue(
				new ApiError(401, "Unauthorized", {
					code: "unauthorized",
					message: "Unauthorized",
					request_id: "req-topology-401",
					recoverable: true,
					next_step: "重新登录后重试",
				}),
			);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByText("当前无权查看拓扑")).toBeInTheDocument();
			});

			const graphCanvas = screen.getByTestId("topology-graph-canvas");
			expect(screen.queryByText("拓扑暂时不可用")).not.toBeInTheDocument();
			expect(within(graphCanvas).getByText("request_id · req-topology-401")).toBeInTheDocument();
			expect(screen.getByText("重新登录后重试")).toBeInTheDocument();
		});

		it("keeps topology nodes visible even with stale data", async () => {
			mockGetAggregateTopology.mockResolvedValue({
				...aggregateTopologyFixture,
				freshness: {
					status: "stale",
					checked_at: "2026-03-22T11:20:00Z",
				},
			});

			renderWithRouter();

			await waitFor(() => {
				expect(
					screen.getByTestId("topology-node-instance-instance-alpha"),
				).toBeInTheDocument();
			});
		});

		it("re-reads aggregate topology when refresh is triggered", async () => {
			mockGetAggregateTopology
				.mockResolvedValueOnce(aggregateTopologyFixture)
				.mockResolvedValueOnce({
					...aggregateTopologyFixture,
					request_id: "req-topology-2",
				});

			renderWithRouter();

			await waitFor(() => {
				expect(
					screen.getByTestId("topology-node-instance-instance-alpha"),
				).toBeInTheDocument();
			});

			const refreshButton = await ensureTopologyControlVisible(/刷新/i);
			fireEvent.click(refreshButton);

			await waitFor(() => {
				expect(mockGetAggregateTopology).toHaveBeenCalledTimes(2);
			});
		});

		it("re-reads aggregate topology when retry is triggered from the failed state", async () => {
			mockGetAggregateTopology
				.mockRejectedValueOnce(
					new ApiError(503, "OpenClaw upstream unavailable", {
						code: "source_unavailable",
						message: "OpenClaw upstream unavailable",
						request_id: "req-topology-503",
						recoverable: true,
						next_step: "检查实例连通性后重试",
					}),
				)
				.mockResolvedValueOnce({
					...aggregateTopologyFixture,
				});

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
			});

			fireEvent.click(screen.getByRole("button", { name: "重试" }));

			await waitFor(() => {
				expect(
					screen.getByTestId("topology-node-instance-instance-alpha"),
				).toBeInTheDocument();
			});

			expect(mockGetAggregateTopology).toHaveBeenCalledTimes(2);
		});
	});

	describe("routing stage compliance", () => {
		it("renders only the canvas without external panels", async () => {
			mockGetAggregateTopology.mockResolvedValue(aggregateTopologyFixture);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByTestId("topology-graph-canvas")).toBeInTheDocument();
			});

			expect(screen.queryByTestId("topology-footer-summary")).not.toBeInTheDocument();
			expect(screen.queryByText("请求线索")).not.toBeInTheDocument();
		});

		it("renders session nodes connected via edges from backend", async () => {
			mockGetAggregateTopology.mockResolvedValue(aggregateTopologyFixture);

			renderWithRouter();

			await waitFor(() => {
				expect(
					screen.getByTestId("topology-node-session-agent:agent-alpha:main"),
				).toBeInTheDocument();
			});

			expect(
				screen.getByTestId("topology-node-session-agent:agent-alpha:main"),
			).toBeInTheDocument();
		});

		it("renders tool nodes connected via edges from backend", async () => {
			mockGetAggregateTopology.mockResolvedValue(topologyWithTools);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByTestId("topology-node-tool-read")).toBeInTheDocument();
			});

			expect(screen.getByTestId("topology-node-tool-read")).toBeInTheDocument();
		});
	});
});
