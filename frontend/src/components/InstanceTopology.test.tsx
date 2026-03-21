import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as instanceClient from "../api/instanceClient";
import type { InstanceItem } from "../api/types";

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

const instanceRecords: InstanceItem[] = [
	{
		id: "instance-alpha",
		name: "alpha-instance",
		type: "openclaw",
		endpoint: "http://127.0.0.1:28789",
		status: "active",
		last_check_at: "2026-03-22T12:05:00Z",
		created_at: "2026-03-22T08:00:00Z",
	},
	{
		id: "instance-empty",
		name: "empty-instance",
		type: "openclaw",
		endpoint: "http://127.0.0.1:38789",
		status: "inactive",
		last_check_at: "2026-03-22T11:20:00Z",
		created_at: "2026-03-22T09:10:00Z",
	},
];

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
		vi.spyOn(instanceClient, "listInstances").mockResolvedValue(instanceRecords);
	});

	it("uses aggregate topology and exposes fixed relationship actions with canonical drill-down", async () => {
		mockGetAggregateTopology.mockResolvedValue(aggregateTopologyFixture);

		renderWithRouter();

		await waitFor(() => {
			expect(mockGetAggregateTopology).toHaveBeenCalledTimes(1);
		});

		expect(screen.getByText("Alpha Agent")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "查看实例 alpha-instance" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "关系实例 alpha-instance" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "配置实例 alpha-instance" })).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: "进入实例 alpha-instance" }),
		).toHaveAttribute("href", "/session/instance-alpha/agent-alpha");
		expect(
			screen.getByRole("link", { name: "进入 agent Alpha Agent" }),
		).toHaveAttribute("href", "/session/instance-alpha/agent-alpha");
		expect(screen.getByText("fresh · 2026-03-22T12:05:00Z")).toBeInTheDocument();
	});

	it("shows explicit 未暴露 sections and disables instance enter when no drill-down exists", async () => {
		mockGetAggregateTopology.mockResolvedValue(aggregateTopologyFixture);

		renderWithRouter();

		await waitFor(() => {
			expect(screen.getByText("技能关系")).toBeInTheDocument();
		});

		expect(screen.getByText("未暴露技能数据")).toBeInTheDocument();
		expect(screen.getByText("未暴露外接 ACP")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "进入实例 empty-instance" }),
		).toBeDisabled();
		expect(screen.getByText("OpenClaw upstream unavailable")).toBeInTheDocument();
		expect(screen.getByText("code · source_unavailable")).toBeInTheDocument();
		expect(screen.getByText("request_id · req-topology-1")).toBeInTheDocument();
		expect(screen.getByText("recoverable · true")).toBeInTheDocument();
		expect(screen.getByText("checked_at · 2026-03-22T11:20:00Z")).toBeInTheDocument();
	});

	it("reuses the instance config modal from topology actions", async () => {
		mockGetAggregateTopology.mockResolvedValue(aggregateTopologyFixture);

		renderWithRouter();

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "配置实例 alpha-instance" })).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole("button", { name: "配置实例 alpha-instance" }));

		await waitFor(() => {
			expect(screen.getByText("编辑实例")).toBeInTheDocument();
		});

		expect(screen.getByLabelText("实例名称")).toHaveValue("alpha-instance");
		expect(screen.getByLabelText("端点地址")).toHaveValue("http://127.0.0.1:28789");
	});

	it("shows loading and error states around aggregate reads", async () => {
		mockGetAggregateTopology.mockImplementation(() => new Promise(() => {}));
		vi.spyOn(instanceClient, "listInstances").mockImplementation(
			() => new Promise(() => {}),
		);

		renderWithRouter();

		expect(screen.getByText("加载中...")).toBeInTheDocument();
	});

	it("surfaces aggregate request failures", async () => {
		mockGetAggregateTopology.mockRejectedValue(new Error("聚合拓扑失败"));

		renderWithRouter();

		await waitFor(() => {
			expect(screen.getByText(/错误: 聚合拓扑失败/i)).toBeInTheDocument();
		});
	});
});
