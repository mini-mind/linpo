import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import SessionPage from "./SessionPage";

const listInstancesMock = vi.fn();

vi.mock("../api/instanceClient", async () => {
	const actual = await vi.importActual<typeof import("../api/instanceClient")>(
		"../api/instanceClient",
	);
	return {
		...actual,
		listInstances: () => listInstancesMock(),
	};
});

vi.mock("../hooks/useIsMobile", () => ({
	useIsMobile: () => false,
}));

vi.mock("./AgentWorkspace", () => ({
	AgentWorkspace: () => <div>workspace</div>,
}));

describe("SessionPage", () => {
	beforeEach(() => {
		listInstancesMock.mockReset();
		window.localStorage.clear();
	});

	describe("direct sidebar entry (no agentId in URL)", () => {
		it("calls listInstances() on mount to fetch instance data", async () => {
			listInstancesMock.mockResolvedValue([]);

			render(
				<MemoryRouter initialEntries={["/session"]}>
					<Routes>
						<Route path="/session" element={<SessionPage />} />
						<Route path="/session/:agentId" element={<SessionPage />} />
					</Routes>
				</MemoryRouter>,
			);

			await waitFor(() => {
				expect(listInstancesMock).toHaveBeenCalledTimes(1);
			});
		});

		it("shows loading state while fetching instances", async () => {
			listInstancesMock.mockImplementation(() => new Promise(() => {}));

			render(
				<MemoryRouter initialEntries={["/session"]}>
					<Routes>
						<Route path="/session" element={<SessionPage />} />
						<Route path="/session/:agentId" element={<SessionPage />} />
					</Routes>
				</MemoryRouter>,
			);

			expect(screen.getByText("加载中...")).toBeInTheDocument();
		});

		it("renders fetched instances with real data in InstanceList", async () => {
			listInstancesMock.mockResolvedValue([
				{
					id: "inst-1",
					name: "Production Server",
					type: "openclaw",
					endpoint: "http://localhost:18789",
					status: "connected",
					last_check_at: null,
					created_at: "2026-03-19T00:00:00Z",
				},
				{
					id: "inst-2",
					name: "Development Instance",
					type: "openclaw",
					endpoint: "http://localhost:28789",
					status: "disconnected",
					last_check_at: "2026-03-19T10:00:00Z",
					created_at: "2026-03-19T00:00:00Z",
				},
			]);

			render(
				<MemoryRouter initialEntries={["/session"]}>
					<Routes>
						<Route path="/session" element={<SessionPage />} />
						<Route path="/session/:agentId" element={<SessionPage />} />
					</Routes>
				</MemoryRouter>,
			);

			await waitFor(() => {
				expect(screen.getByText("Production Server")).toBeInTheDocument();
			});
			expect(screen.getByText("Development Instance")).toBeInTheDocument();
		});

		it("shows placeholder when no instance is selected (sidebar entry)", async () => {
			listInstancesMock.mockResolvedValue([
				{
					id: "inst-1",
					name: "Test Instance",
					type: "openclaw",
					endpoint: "http://localhost:18789",
					status: "connected",
					last_check_at: null,
					created_at: "2026-03-19T00:00:00Z",
				},
			]);

			render(
				<MemoryRouter initialEntries={["/session"]}>
					<Routes>
						<Route path="/session" element={<SessionPage />} />
						<Route path="/session/:agentId" element={<SessionPage />} />
					</Routes>
				</MemoryRouter>,
			);

			await waitFor(() => {
				expect(screen.getByText("Test Instance")).toBeInTheDocument();
			});
			expect(screen.getByText("选择一个实例开始对话")).toBeInTheDocument();
		});

		it("shows empty state when no instances exist", async () => {
			listInstancesMock.mockResolvedValue([]);

			render(
				<MemoryRouter initialEntries={["/session"]}>
					<Routes>
						<Route path="/session" element={<SessionPage />} />
						<Route path="/session/:agentId" element={<SessionPage />} />
					</Routes>
				</MemoryRouter>,
			);

			await waitFor(() => {
				expect(screen.getByText("暂无实例")).toBeInTheDocument();
			});
		});
	});

	describe("topology entry (with agentId in URL)", () => {
		it("renders instance list and workspace when entered with agentId", async () => {
			listInstancesMock.mockResolvedValue([
				{
					id: "inst-1",
					name: "Test Instance",
					type: "openclaw",
					endpoint: "http://localhost:18789",
					status: "connected",
					last_check_at: null,
					created_at: "2026-03-19T00:00:00Z",
				},
			]);

			render(
				<MemoryRouter initialEntries={["/session/inst-1"]}>
					<Routes>
						<Route path="/session" element={<SessionPage />} />
						<Route path="/session/:agentId" element={<SessionPage />} />
					</Routes>
				</MemoryRouter>,
			);

			await waitFor(() => {
				expect(screen.getByText("Test Instance")).toBeInTheDocument();
			});
			await waitFor(() => {
				expect(screen.getByText("workspace")).toBeInTheDocument();
			});
		});

		it("highlights selected instance in the list", async () => {
			listInstancesMock.mockResolvedValue([
				{
					id: "inst-1",
					name: "First Instance",
					type: "openclaw",
					endpoint: "http://localhost:18789",
					status: "connected",
					last_check_at: null,
					created_at: "2026-03-19T00:00:00Z",
				},
				{
					id: "inst-2",
					name: "Second Instance",
					type: "openclaw",
					endpoint: "http://localhost:28789",
					status: "connected",
					last_check_at: null,
					created_at: "2026-03-19T00:00:00Z",
				},
			]);

			render(
				<MemoryRouter initialEntries={["/session/inst-2"]}>
					<Routes>
						<Route path="/session" element={<SessionPage />} />
						<Route path="/session/:agentId" element={<SessionPage />} />
					</Routes>
				</MemoryRouter>,
			);

			await waitFor(() => {
				expect(screen.getByText("First Instance")).toBeInTheDocument();
			});
			expect(screen.getByText("Second Instance")).toBeInTheDocument();

			const selectedButton = screen.getByRole("button", {
				name: /Second Instance/,
			});
			expect(selectedButton).toHaveStyle({ background: "#eff6ff" });
		});
	});

	describe("instance selection and navigation", () => {
		it("navigates to session/:instanceId when instance is clicked", async () => {
			listInstancesMock.mockResolvedValue([
				{
					id: "inst-1",
					name: "Click Me",
					type: "openclaw",
					endpoint: "http://localhost:18789",
					status: "connected",
					last_check_at: null,
					created_at: "2026-03-19T00:00:00Z",
				},
			]);

			render(
				<MemoryRouter initialEntries={["/session"]}>
					<Routes>
						<Route path="/session" element={<SessionPage />} />
						<Route
							path="/session/:agentId"
							element={<div data-testid="session-detail">Session Detail</div>}
						/>
					</Routes>
				</MemoryRouter>,
			);

			await waitFor(() => {
				expect(screen.getByText("Click Me")).toBeInTheDocument();
			});

			fireEvent.click(screen.getByRole("button", { name: /Click Me/ }));

			await waitFor(() => {
				expect(screen.getByTestId("session-detail")).toBeInTheDocument();
			});
		});

		it("stores selected instance in localStorage", async () => {
			listInstancesMock.mockResolvedValue([
				{
					id: "inst-42",
					name: "Storage Test",
					type: "openclaw",
					endpoint: "http://localhost:18789",
					status: "connected",
					last_check_at: null,
					created_at: "2026-03-19T00:00:00Z",
				},
			]);

			render(
				<MemoryRouter initialEntries={["/session"]}>
					<Routes>
						<Route path="/session" element={<SessionPage />} />
						<Route path="/session/:agentId" element={<SessionPage />} />
					</Routes>
				</MemoryRouter>,
			);

			await waitFor(() => {
				expect(screen.getByText("Storage Test")).toBeInTheDocument();
			});

			fireEvent.click(screen.getByRole("button", { name: /Storage Test/ }));

			await waitFor(() => {
				expect(window.localStorage.getItem("linpo.currentInstanceId")).toBe(
					"inst-42",
				);
			});
		});
	});

	describe("error handling", () => {
		it("shows error message from API when instance list fetch fails", async () => {
			listInstancesMock.mockRejectedValue(new Error("无法连接到服务器"));

			render(
				<MemoryRouter initialEntries={["/session"]}>
					<Routes>
						<Route path="/session" element={<SessionPage />} />
						<Route path="/session/:agentId" element={<SessionPage />} />
					</Routes>
				</MemoryRouter>,
			);

			await waitFor(() => {
				expect(screen.getByText("无法连接到服务器")).toBeInTheDocument();
			});
		});

		it("shows generic error message when error has no message", async () => {
			listInstancesMock.mockRejectedValue(new Error());

			render(
				<MemoryRouter initialEntries={["/session"]}>
					<Routes>
						<Route path="/session" element={<SessionPage />} />
						<Route path="/session/:agentId" element={<SessionPage />} />
					</Routes>
				</MemoryRouter>,
			);

			await waitFor(() => {
				expect(screen.getByText("获取实例列表失败")).toBeInTheDocument();
			});
		});
	});
});
