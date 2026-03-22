import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
			drilldown_path: "/session/instance-1/agent-1",
		},
	],
	edges: [
		{
			source: "instance:instance-1",
			target: "agent:instance-1:agent-1",
			kind: "instance_agent",
		},
	],
	skills: [],
	external_acps: [],
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

	it("renders graph-only canvas without sidebar or detail panels", async () => {
		mockGetAggregateTopology.mockResolvedValue(aggregateTopologyFixture);

		renderWithRouter();

		await waitFor(() => {
			expect(screen.getByTestId("topology-graph-canvas")).toBeInTheDocument();
		});

		expect(screen.queryByTestId("topology-sidebar")).not.toBeInTheDocument();
		expect(screen.queryByTestId("topology-detail-panel")).not.toBeInTheDocument();
		expect(screen.queryByTestId("topology-config-panel")).not.toBeInTheDocument();
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});

	it("provides canonical drill-down link to session page", async () => {
		mockGetAggregateTopology.mockResolvedValue(aggregateTopologyFixture);

		renderWithRouter();

		await waitFor(() => {
			expect(screen.getByTestId("topology-node-agent-agent-1")).toBeInTheDocument();
		});

		const drilldownLink = screen.getByTestId("drilldown-link-agent-1");
		expect(drilldownLink).toBeInTheDocument();
		expect(drilldownLink).toHaveAttribute("href", "/session/instance-1/agent-1");
	});

	it("does not show footer summary (observer-only constraint)", async () => {
		mockGetAggregateTopology.mockResolvedValue(aggregateTopologyFixture);

		renderWithRouter();

		await waitFor(() => {
			expect(screen.getByTestId("topology-graph-canvas")).toBeInTheDocument();
		});

		expect(screen.queryByText(/实例/)).not.toBeInTheDocument();
		expect(screen.queryByText(/agents/)).not.toBeInTheDocument();
	});

	it("does not expose destructive or write-operation controls", async () => {
		mockGetAggregateTopology.mockResolvedValue(aggregateTopologyFixture);

		renderWithRouter();

		await waitFor(() => {
			expect(screen.getByTestId("topology-graph-canvas")).toBeInTheDocument();
		});

		expect(screen.queryByRole("button", { name: /删除/i })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /暂停/i })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /重置/i })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /发送/i })).not.toBeInTheDocument();
	});
});