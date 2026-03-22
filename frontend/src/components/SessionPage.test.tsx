import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SessionPage, { buildCanonicalSessionPath } from "./SessionPage";

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

vi.mock("./AgentWorkspace", async () => {
	const reactRouterDom =
		await vi.importActual<typeof import("react-router-dom")>(
			"react-router-dom",
		);

	return {
		AgentWorkspace: (props: {
			agentId?: string;
			instanceId?: string;
		}) => {
			const { agentId, instanceId } = reactRouterDom.useParams<{
				agentId?: string;
				instanceId?: string;
			}>();
			return (
				<div data-testid="session-stream-shell">
					<div>{`workspace:${instanceId ?? "none"}:${agentId ?? "none"}`}</div>
					<div>{`workspace-props:${props.instanceId ?? "none"}:${props.agentId ?? "none"}`}</div>
					<div data-testid="session-input-shell">observer-only placeholder</div>
				</div>
			);
		},
	};
});

function buildInstance(
	id: string,
	name: string,
	status: "connected" | "disconnected" = "connected",
) {
	return {
		id,
		name,
		type: "openclaw" as const,
		endpoint: `http://localhost/${id}`,
		status,
		last_check_at: null,
		created_at: "2026-03-19T00:00:00Z",
	};
}

function LocationDisplay(): JSX.Element {
	const location = useLocation();
	return (
		<div data-testid="location-display">{`${location.pathname}${location.search}`}</div>
	);
}

function renderSessionPage(initialEntry: string): void {
	render(
		<MemoryRouter initialEntries={[initialEntry]}>
			<LocationDisplay />
			<Routes>
				<Route path="/session" element={<SessionPage />} />
				<Route path="/session/:instanceId" element={<SessionPage />} />
				<Route path="/session/:instanceId/:agentId" element={<SessionPage />} />
				<Route path="/overview" element={<div>overview-page</div>} />
			</Routes>
		</MemoryRouter>,
	);
}

describe("SessionPage", () => {
	beforeEach(() => {
		listInstancesMock.mockReset();
		window.localStorage.clear();
	});

	it("buildCanonicalSessionPath returns the canonical drill-down shape", () => {
		expect(buildCanonicalSessionPath("instance alpha")).toBe(
			"/session/instance%20alpha/main",
		);

		expect(buildCanonicalSessionPath("instance alpha", "agent/beta", "?focus=active")).toBe(
			"/session/instance%20alpha/agent%2Fbeta?focus=active",
		);
	});

	it("upgrades legacy /session/:instanceId to canonical route and preserves query string", async () => {
		listInstancesMock.mockResolvedValue([
			buildInstance("inst-1", "First Instance"),
			buildInstance("inst-2", "Second Instance"),
		]);

		renderSessionPage("/session/inst-2?focus=active");

		await waitFor(() => {
			expect(screen.getByTestId("location-display")).toHaveTextContent(
				`${buildCanonicalSessionPath("inst-2")}?focus=active`,
			);
		});

		await waitFor(() => {
			expect(screen.getByText("workspace:inst-2:main")).toBeInTheDocument();
		});
	});

	it("renders workspace on canonical session route with instance name in header", async () => {
		listInstancesMock.mockResolvedValue([
			buildInstance("inst-1", "First Instance"),
			buildInstance("inst-2", "Second Instance"),
		]);

		renderSessionPage("/session/inst-2/main");

		await waitFor(() => {
			expect(screen.getByRole("heading", { name: "Second Instance" })).toBeInTheDocument();
		});

		expect(screen.getByText("workspace:inst-2:main")).toBeInTheDocument();
	});

	it("passes canonical route context to AgentWorkspace and syncs remembered instance", async () => {
		window.localStorage.setItem("linpo.currentInstanceId", "inst-1");
		listInstancesMock.mockResolvedValue([
			buildInstance("inst-1", "First Instance"),
			buildInstance("inst-2", "Second Instance"),
		]);

		renderSessionPage("/session/inst-2/main");

		await waitFor(() => {
			expect(screen.getByText("workspace-props:inst-2:main")).toBeInTheDocument();
		});

		await waitFor(() => {
			expect(window.localStorage.getItem("linpo.currentInstanceId")).toBe("inst-2");
		});
	});

	it("shows connection status in header", async () => {
		listInstancesMock.mockResolvedValue([
			buildInstance("inst-1", "First Instance"),
			buildInstance("inst-2", "Second Instance", "disconnected"),
		]);

		renderSessionPage("/session/inst-2/main");

		await waitFor(() => {
			expect(screen.getByText(/disconnected/i)).toBeInTheDocument();
		});
	});

	it("shows empty state when no instances exist", async () => {
		listInstancesMock.mockResolvedValue([]);

		renderSessionPage("/session");

		await waitFor(() => {
			expect(screen.getByText("暂无实例")).toBeInTheDocument();
		});
	});

	it("shows error message when instance list fetch fails and no valid session route", async () => {
		listInstancesMock.mockRejectedValue(new Error("无法连接到服务器"));

		renderSessionPage("/session");

		await waitFor(() => {
			expect(screen.getByText(/无法连接到服务器/i)).toBeInTheDocument();
		});
	});

	it("auto-redirects to first instance when on /session without instance", async () => {
		listInstancesMock.mockResolvedValue([
			buildInstance("inst-1", "First Instance"),
			buildInstance("inst-2", "Second Instance"),
		]);

		renderSessionPage("/session");

		await waitFor(() => {
			expect(screen.getByTestId("location-display")).toHaveTextContent(
				buildCanonicalSessionPath("inst-1"),
			);
		});
	});

	describe("page shell testid contracts", () => {
		it("exposes session-stream-shell testid on the main content area", async () => {
			listInstancesMock.mockResolvedValue([
				buildInstance("inst-1", "First Instance"),
			]);

			renderSessionPage("/session/inst-1/main");

			await waitFor(() => {
				expect(screen.getByText("workspace:inst-1:main")).toBeInTheDocument();
			});

			const streamShell = screen.getByTestId("session-stream-shell");
			expect(streamShell).toBeInTheDocument();
		});

		it("exposes session-input-shell testid on the input area", async () => {
			listInstancesMock.mockResolvedValue([
				buildInstance("inst-1", "First Instance"),
			]);

			renderSessionPage("/session/inst-1/main");

			await waitFor(() => {
				expect(screen.getByText("workspace:inst-1:main")).toBeInTheDocument();
			});

			const inputShell = screen.getByTestId("session-input-shell");
			expect(inputShell).toBeInTheDocument();
		});
	});

	describe("minimal three-zone layout", () => {
		it("does not render instance list sidebar", async () => {
			listInstancesMock.mockResolvedValue([
				buildInstance("inst-1", "First Instance"),
				buildInstance("inst-2", "Second Instance"),
			]);

			renderSessionPage("/session/inst-1/main");

			await waitFor(() => {
				expect(screen.getByText("workspace:inst-1:main")).toBeInTheDocument();
			});

			expect(screen.queryByRole("button", { name: /First Instance/ })).not.toBeInTheDocument();
			expect(screen.queryByRole("button", { name: /Second Instance/ })).not.toBeInTheDocument();
		});

		it("shows only instance name header, message stream, and input area", async () => {
			listInstancesMock.mockResolvedValue([
				buildInstance("inst-1", "Test Instance"),
			]);

			renderSessionPage("/session/inst-1/main");

			await waitFor(() => {
				expect(screen.getByRole("heading", { name: "Test Instance" })).toBeInTheDocument();
			});

			expect(screen.getByTestId("session-stream-shell")).toBeInTheDocument();
			expect(screen.getByTestId("session-input-shell")).toBeInTheDocument();
		});
	});
});