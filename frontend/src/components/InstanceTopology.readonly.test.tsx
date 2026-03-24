import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

import { InstanceTopology } from "./InstanceTopology";

const aggregateTopologyFixture = {
	request_id: "req-topology-readonly",
	freshness: {
		status: "fresh" as const,
		checked_at: "2026-03-22T12:05:00Z",
	},
	partial_failure: false,
	diagnostics: [],
	instances: [
		{
			node_id: "instance:instance-1",
			instance_id: "instance-1",
			name: "测试实例1",
			type: "openclaw",
			status: "active",
			last_check_at: "2026-03-22T12:05:00Z",
			created_at: "2026-03-22T08:00:00Z",
		},
	],
	agents: [
		{
			node_id: "agent:instance-1:agent-1",
			instance_id: "instance-1",
			instance_name: "测试实例1",
			agent_id: "agent-1",
			agent_name: "测试Agent",
			status: "idle" as const,
			is_active: true,
			last_active_at: "2026-03-22T12:00:00Z",
				drilldown_path:
					"/session/agent-1/__none__/__new__?instanceId=instance-1",
			},
		],
	sessions: [
		{
			node_id: "session:instance-1:agent-1:agent:agent-1:main",
			instance_id: "instance-1",
			instance_name: "测试实例1",
			agent_id: "agent-1",
			agent_name: "测试Agent",
			session_key: "agent:agent-1:main",
			label: "agent:agent-1:main",
			updated_at: "2026-03-22T12:02:00Z",
		},
	],
	tools: [],
	edges: [
		{
			source: "instance:instance-1",
			target: "agent:instance-1:agent-1",
			kind: "instance_agent",
		},
		{
			source: "agent:instance-1:agent-1",
			target: "session:instance-1:agent-1:agent:agent-1:main",
			kind: "agent_session",
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

describe("InstanceTopology readonly mode", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders a routing-graph stage shell without sidebar or detail panels", async () => {
		mockGetAggregateTopology.mockResolvedValue(aggregateTopologyFixture);

		renderWithRouter();

		await waitFor(() => {
			expect(screen.getByTestId("topology-routing-stage")).toBeInTheDocument();
			expect(screen.getByTestId("topology-graph-canvas")).toBeInTheDocument();
		});

		expect(screen.queryByTestId("topology-sidebar")).not.toBeInTheDocument();
		expect(screen.queryByTestId("topology-detail-panel")).not.toBeInTheDocument();
		expect(screen.queryByTestId("topology-config-panel")).not.toBeInTheDocument();
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});

	it("shows explicit entry and disabled states without write controls", async () => {
		mockGetAggregateTopology.mockResolvedValue(aggregateTopologyFixture);

		renderWithRouter();

		await waitFor(() => {
			expect(screen.getByTestId("topology-node-agent-agent-1")).toBeInTheDocument();
		});
		const agentNode = screen.getByTestId("topology-node-agent-agent-1");
		const instanceNode = screen.getByTestId("topology-node-instance-instance-1");

		const entryLink = screen.getByRole("link", { name: "进入默认会话" });
		expect(entryLink).toHaveAttribute(
			"href",
			buildSessionEntryPath({
				instanceId: "instance-1",
				agentId: "agent-1",
			}),
		);
		expect(within(agentNode).getByText("可进入")).toBeInTheDocument();
		expect(
			within(instanceNode).getByText("实例节点不提供会话入口"),
		).toBeInTheDocument();
	});

	it("shows compact request clues instead of observer-only footer framing", async () => {
		mockGetAggregateTopology.mockResolvedValue(aggregateTopologyFixture);

		renderWithRouter();

		await waitFor(() => {
			expect(screen.getByTestId("topology-graph-canvas")).toBeInTheDocument();
		});

		expect(screen.getByText("实例")).toBeInTheDocument();
		expect(screen.getByText("智能体")).toBeInTheDocument();
		expect(screen.getByText("会话")).toBeInTheDocument();
		expect(screen.getByText("工具")).toBeInTheDocument();
		expect(
			screen.getByRole("heading", { name: "Routing Graph 主舞台" }),
		).toBeInTheDocument();
		expect(screen.getByText("请求线索")).toBeInTheDocument();
		expect(
			screen.getByText("聚合链路继续使用 getAggregateTopology，不引入旁路面板。"),
		).toBeInTheDocument();
		expect(screen.queryByTestId("topology-footer-summary")).not.toBeInTheDocument();
	});

	it("does not expose destructive or write-operation controls", async () => {
		mockGetAggregateTopology.mockResolvedValue(aggregateTopologyFixture);

		renderWithRouter();

		await waitFor(() => {
			expect(screen.getByTestId("topology-graph-canvas")).toBeInTheDocument();
		});

		expect(screen.queryByText("SKILL")).not.toBeInTheDocument();
		expect(screen.queryByText("ACP")).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /删除/i })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /暂停/i })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /重置/i })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /发送/i })).not.toBeInTheDocument();
	});
});
