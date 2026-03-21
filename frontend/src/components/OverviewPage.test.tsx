import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import * as instanceClient from "../api/instanceClient";
import type { InstanceItem } from "../api/types";

import { OverviewPage } from "./OverviewPage";

vi.mock("../hooks/useIsMobile", () => ({
	useIsMobile: () => false,
}));

const mockInstances: InstanceItem[] = [
	{
		id: "instance-1",
		name: "测试实例1",
		type: "openclaw",
		endpoint: "http://127.0.0.1:28789",
		status: "active",
		last_check_at: "2025-03-18T10:00:00Z",
		created_at: "2025-03-18T08:00:00Z",
	},
	{
		id: "instance-2",
		name: "测试实例2",
		type: "openclaw",
		endpoint: "http://127.0.0.1:38789",
		status: "inactive",
		last_check_at: null,
		created_at: "2025-03-18T09:00:00Z",
	},
];

const renderWithRouter = (initialEntries = ["/overview"]) => {
	return render(
		<MemoryRouter initialEntries={initialEntries}>
			<OverviewPage />
		</MemoryRouter>,
	);
};

describe("OverviewPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		window.localStorage.clear();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("Loading and Error States", () => {
		it("shows loading state while fetching instances", () => {
			vi.spyOn(instanceClient, "listInstances").mockImplementation(
				() => new Promise(() => {}),
			);

			renderWithRouter();

			expect(screen.getByText("加载中...")).toBeInTheDocument();
		});

		it("shows error state when fetch fails", async () => {
			vi.spyOn(instanceClient, "listInstances").mockRejectedValue(
				new Error("网络错误"),
			);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByText(/错误/i)).toBeInTheDocument();
			});
		});
	});

	describe("Empty State", () => {
		it("renders empty state when no instances exist", async () => {
			vi.spyOn(instanceClient, "listInstances").mockResolvedValue([]);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByText("暂无实例")).toBeInTheDocument();
			});
		});

		it("shows navigation to topology in empty state", async () => {
			vi.spyOn(instanceClient, "listInstances").mockResolvedValue([]);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByText("暂无实例")).toBeInTheDocument();
			});

			// Should have a link/button to go to topology to add instances
			expect(
				screen.getByRole("link", { name: /前往拓扑/i }),
			).toBeInTheDocument();
		});
	});

	describe("Instance Summary Statistics", () => {
		it("displays total instance count", async () => {
			vi.spyOn(instanceClient, "listInstances").mockResolvedValue(
				mockInstances,
			);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByText("实例总数")).toBeInTheDocument();
			});

			// Find the stat card containing "实例总数" and check its value
			const totalCard = screen.getByText("实例总数").parentElement;
			expect(totalCard).toHaveTextContent("2");
		});

		it("displays active instance count", async () => {
			vi.spyOn(instanceClient, "listInstances").mockResolvedValue(
				mockInstances,
			);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByText("活跃实例")).toBeInTheDocument();
			});

			// Find the stat card containing "活跃实例" and check its value
			const activeCard = screen.getByText("活跃实例").parentElement;
			expect(activeCard).toHaveTextContent("1");
		});

		it("displays inactive instance count as needing attention", async () => {
			vi.spyOn(instanceClient, "listInstances").mockResolvedValue(
				mockInstances,
			);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByText("需要关注")).toBeInTheDocument();
			});

			// Find the stat card containing "需要关注" and check its value
			const attentionCard = screen.getByText("需要关注").parentElement;
			expect(attentionCard).toHaveTextContent("1");
		});
	});

	describe("Instance List", () => {
		it("renders instance cards with name and status", async () => {
			vi.spyOn(instanceClient, "listInstances").mockResolvedValue(
				mockInstances,
			);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByText("测试实例1")).toBeInTheDocument();
			});

			expect(screen.getByText("测试实例2")).toBeInTheDocument();
			expect(screen.getByText("活跃")).toBeInTheDocument();
			expect(screen.getByText("未活跃")).toBeInTheDocument();
		});

		it("shows active instances with link to session page", async () => {
			vi.spyOn(instanceClient, "listInstances").mockResolvedValue(
				mockInstances,
			);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByText("测试实例1")).toBeInTheDocument();
			});

			// Active instance should have link to /session/:instanceId/main
			const activeInstanceLink = screen.getByRole("link", {
				name: /进入会话 - 测试实例1/i,
			});
			expect(activeInstanceLink).toHaveAttribute(
				"href",
				"/session/instance-1/main",
			);
		});

		it("shows inactive instances with attention indicator", async () => {
			vi.spyOn(instanceClient, "listInstances").mockResolvedValue(
				mockInstances,
			);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByText("测试实例2")).toBeInTheDocument();
			});

			// Inactive instance should show attention indicator
			expect(
				screen.getByRole("img", { name: /需要关注/i }),
			).toBeInTheDocument();
		});
	});

	describe("Navigation", () => {
		it("provides link to topology page", async () => {
			vi.spyOn(instanceClient, "listInstances").mockResolvedValue(
				mockInstances,
			);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByText("实例总数")).toBeInTheDocument();
			});

			const topologyLink = screen.getByRole("link", { name: /查看拓扑/i });
			expect(topologyLink).toHaveAttribute("href", "/topology");
		});

		it("provides link to session page", async () => {
			vi.spyOn(instanceClient, "listInstances").mockResolvedValue(
				mockInstances,
			);

			renderWithRouter();

			await waitFor(() => {
				expect(screen.getByText("实例总数")).toBeInTheDocument();
			});

			// The nav link says "进入会话" with icon prefix
			const sessionNavLinks = screen.getAllByRole("link", { name: /进入会话/i });
			// Find the one that goes to /session (not /session/:instanceId/main)
			const sessionNavLink = sessionNavLinks.find(
				(link) => link.getAttribute("href") === "/session",
			);
			expect(sessionNavLink).toBeDefined();
			expect(sessionNavLink).toHaveAttribute("href", "/session");
		});
	});
});