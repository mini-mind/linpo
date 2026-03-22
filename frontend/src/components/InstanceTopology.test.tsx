import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";

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
			drilldown_path: "/session/instance-alpha/agent-alpha",
		},
	],
	edges: [
		{
			source: "instance:instance-alpha",
			target: "agent:instance-alpha:agent-alpha",
			kind: "instance_agent",
		},
	],
	skills: [],
	external_acps: [],
};

const topologyWithSkillsAndAcps = {
	...aggregateTopologyFixture,
	skills: [
		{
			node_id: "skill:skill-1",
			id: "skill-1",
			name: "Code Analysis",
		},
	],
	external_acps: [
		{
			node_id: "acp:acp-1",
			id: "acp-1",
			name: "External API",
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
			target: "skill:skill-1",
			kind: "agent_skill",
		},
		{
			source: "agent:instance-alpha:agent-alpha",
			target: "acp:acp-1",
			kind: "agent_external_acp",
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

describe("InstanceTopology", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		window.localStorage.clear();
	});

	describe("graph canvas structure", () => {
		it("exposes topology-graph-canvas testid on the main canvas", async () => {
			mockGetAggregateTopology.mockResolvedValue(aggregateTopologyFixture);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByTestId("topology-graph-canvas")).toBeInTheDocument();
			});
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
		});

		it("renders minimal title and canvas controls", async () => {
			mockGetAggregateTopology.mockResolvedValue(aggregateTopologyFixture);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByRole("heading", { name: "拓扑关系图" })).toBeInTheDocument();
			});

			expect(screen.getByRole("button", { name: "适配画布" })).toBeInTheDocument();
			expect(screen.getByRole("button", { name: "刷新拓扑" })).toBeInTheDocument();
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

			expect(screen.getByText("alpha-instance")).toBeInTheDocument();
			expect(
				screen.getByTestId("topology-node-instance-instance-empty"),
			).toBeInTheDocument();
		});

		it("renders agent nodes with canonical drill-down link", async () => {
			mockGetAggregateTopology.mockResolvedValue(aggregateTopologyFixture);

			renderWithRouter();

			await waitFor(() => {
				expect(
					screen.getByTestId("topology-node-agent-agent-alpha"),
				).toBeInTheDocument();
			});

			expect(screen.getByText("Alpha Agent")).toBeInTheDocument();

			const drilldownLink = screen.getByTestId("drilldown-link-agent-alpha");
			expect(drilldownLink).toBeInTheDocument();
			expect(drilldownLink).toHaveAttribute("href", "/session/instance-alpha/agent-alpha");
		});

		it("renders skill nodes when skills exist", async () => {
			mockGetAggregateTopology.mockResolvedValue(topologyWithSkillsAndAcps);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByText("Code Analysis")).toBeInTheDocument();
			});

			expect(screen.getByTestId("topology-node-skill-Code Analysis")).toBeInTheDocument();
		});

		it("renders external ACP nodes when ACPs exist", async () => {
			mockGetAggregateTopology.mockResolvedValue(topologyWithSkillsAndAcps);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByText("External API")).toBeInTheDocument();
			});

			expect(screen.getByTestId("topology-node-acp-External API")).toBeInTheDocument();
		});

		it("handles empty skills and ACPs without fallback blocks", async () => {
			mockGetAggregateTopology.mockResolvedValue(aggregateTopologyFixture);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByTestId("topology-graph-canvas")).toBeInTheDocument();
			});

			expect(screen.queryByText("未暴露技能数据")).not.toBeInTheDocument();
			expect(screen.queryByText("未暴露外接 ACP")).not.toBeInTheDocument();
		});
	});

	describe("loading and error states", () => {
		it("shows loading state", async () => {
			mockGetAggregateTopology.mockImplementation(() => new Promise(() => {}));

			renderWithRouter();

			expect(screen.getByText("加载拓扑数据...")).toBeInTheDocument();
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

			expect(
				screen.getByText(/错误: OpenClaw upstream unavailable/i),
			).toBeInTheDocument();
			expect(screen.getByText("request_id · req-topology-503")).toBeInTheDocument();
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
	});

	describe("graph-only compliance", () => {
		it("does not render footer summary (graph-only constraint)", async () => {
			mockGetAggregateTopology.mockResolvedValue(aggregateTopologyFixture);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByTestId("topology-graph-canvas")).toBeInTheDocument();
			});

			// Footer summary violates graph-only constraint
			expect(screen.queryByText(/实例/)).not.toBeInTheDocument();
			expect(screen.queryByText(/agents/)).not.toBeInTheDocument();
			expect(screen.queryByText(/skills/)).not.toBeInTheDocument();
			expect(screen.queryByText(/ACPs/)).not.toBeInTheDocument();
		});

		it("renders skill nodes connected via edges from backend", async () => {
			mockGetAggregateTopology.mockResolvedValue(topologyWithSkillsAndAcps);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByText("Code Analysis")).toBeInTheDocument();
			});

			expect(screen.getByTestId("topology-node-skill-Code Analysis")).toBeInTheDocument();
		});

		it("renders external ACP nodes connected via edges from backend", async () => {
			mockGetAggregateTopology.mockResolvedValue(topologyWithSkillsAndAcps);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByText("External API")).toBeInTheDocument();
			});

			expect(screen.getByTestId("topology-node-acp-External API")).toBeInTheDocument();
		});
	});
});