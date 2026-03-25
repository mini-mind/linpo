import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SessionPage, {
	buildCanonicalSessionPath,
	buildSessionEntryPath,
	resolveSessionPageInstanceId,
} from "./SessionPage";

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
			preferredSessionKey?: string | null;
		}) => {
			const { agentId, channelKey, sessionKey } = reactRouterDom.useParams<{
				agentId?: string;
				channelKey?: string;
				sessionKey?: string;
			}>();
			return (
				<div data-testid="session-stream-shell">
					<div>
						{`workspace-route:${agentId ?? "none"}:${channelKey ?? "none"}:${sessionKey ?? "none"}`}
					</div>
					<div>
						{`workspace-props:${props.instanceId ?? "none"}:${props.agentId ?? "none"}:${props.preferredSessionKey ?? "none"}`}
					</div>
					<div data-testid="session-input-shell">session input placeholder</div>
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
				<Route
					path="/session/:agentId/:channelKey/:sessionKey"
					element={<SessionPage />}
				/>
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

	it("buildCanonicalSessionPath returns the canonical agent/channel/session shape", () => {
		expect(buildCanonicalSessionPath("agent alpha")).toBe(
			"/session/agent%20alpha/__none__/__new__",
		);

		expect(
			buildCanonicalSessionPath(
				"agent alpha",
				"channel/beta",
				"session:key",
				"?focus=active",
			),
		).toBe("/session/agent%20alpha/channel%2Fbeta/session%3Akey?focus=active");
	});

	it("buildSessionEntryPath upgrades truthful session context into the new canonical shape", () => {
		expect(
			buildSessionEntryPath({
				instanceId: "instance alpha",
				agentId: "agent/beta",
				preferredSessionKey: "agent:agent/beta:main",
				search: "?focus=active",
			}),
		).toBe(
			"/session/agent%2Fbeta/agent/agent%3Aagent%2Fbeta%3Amain?focus=active&instanceId=instance+alpha",
		);

		expect(
			buildSessionEntryPath({
				instanceId: "instance alpha",
				agentId: "agent/beta",
				search: "?focus=active",
			}),
		).toBe(
			"/session/agent%2Fbeta/__none__/__new__?focus=active&instanceId=instance+alpha",
		);
	});

	it("resolveSessionPageInstanceId keeps explicit URL instance ahead of stored memory", () => {
		expect(
			resolveSessionPageInstanceId({
				search: "?instanceId=inst-2",
				storedInstanceId: "inst-1",
			}),
		).toBe("inst-2");
	});

	it("resolveSessionPageInstanceId falls back to stored memory only when URL has no instance context", () => {
		expect(
			resolveSessionPageInstanceId({
				search: "",
				storedInstanceId: "inst-1",
			}),
		).toBe("inst-1");
	});

	it("renders workspace on canonical session route with instance name in header", async () => {
		listInstancesMock.mockResolvedValue([
			buildInstance("inst-1", "First Instance"),
			buildInstance("inst-2", "Second Instance"),
		]);

		renderSessionPage("/session/main/__none__/__new__?instanceId=inst-2");

		await waitFor(() => {
			expect(screen.getByRole("heading", { name: "Second Instance" })).toBeInTheDocument();
		});

		expect(
			screen.getByText("workspace-route:main:__none__:__new__"),
		).toBeInTheDocument();
	});

	it("passes canonical route context to AgentWorkspace and syncs remembered instance", async () => {
		window.localStorage.setItem("linpo.currentInstanceId", "inst-1");
		listInstancesMock.mockResolvedValue([
			buildInstance("inst-1", "First Instance"),
			buildInstance("inst-2", "Second Instance"),
		]);

		renderSessionPage("/session/main/__none__/__new__?instanceId=inst-2");

		await waitFor(() => {
			expect(screen.getByText("workspace-props:inst-2:main:none")).toBeInTheDocument();
		});

		await waitFor(() => {
			expect(window.localStorage.getItem("linpo.currentInstanceId")).toBe("inst-2");
		});
	});

	it("passes preferred session key from canonical params to AgentWorkspace", async () => {
		window.localStorage.setItem("linpo.currentInstanceId", "inst-1");
		listInstancesMock.mockResolvedValue([
			buildInstance("inst-1", "First Instance"),
			buildInstance("inst-2", "Second Instance"),
		]);

		renderSessionPage(
			"/session/main/agent/agent%3Aagent-alpha%3Amain?instanceId=inst-2",
		);

		await waitFor(() => {
			expect(
				screen.getByText(
					"workspace-props:inst-2:main:agent:agent-alpha:main",
				),
			).toBeInTheDocument();
		});
	});

	it("preserves canonical path and query string instead of upgrading legacy entrypoints", async () => {
		listInstancesMock.mockResolvedValue([
			buildInstance("inst-1", "First Instance"),
			buildInstance("inst-2", "Second Instance"),
		]);

		renderSessionPage("/session/main/__none__/__new__?instanceId=inst-2&focus=active");

		await waitFor(() => {
			expect(screen.getByTestId("location-display")).toHaveTextContent(
				"/session/main/__none__/__new__?instanceId=inst-2&focus=active",
			);
		});

		expect(screen.getByText("workspace-route:main:__none__:__new__")).toBeInTheDocument();
	});

	it("uses stored instance memory only when canonical URL does not provide one", async () => {
		window.localStorage.setItem("linpo.currentInstanceId", "inst-2");
		listInstancesMock.mockResolvedValue([
			buildInstance("inst-1", "First Instance"),
			buildInstance("inst-2", "Second Instance"),
		]);

		renderSessionPage("/session/main/__none__/__new__");

		await waitFor(() => {
			expect(screen.getByText("workspace-props:inst-2:main:none")).toBeInTheDocument();
		});
	});

	it("shows connection status in header", async () => {
		listInstancesMock.mockResolvedValue([
			buildInstance("inst-1", "First Instance"),
			buildInstance("inst-2", "Second Instance", "disconnected"),
		]);

		renderSessionPage("/session/main/__none__/__new__?instanceId=inst-2");

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
				buildSessionEntryPath({
					instanceId: "inst-1",
				}),
			);
		});
	});

		describe("page shell testid contracts", () => {
		it("exposes session-stream-shell testid on the main content area", async () => {
			listInstancesMock.mockResolvedValue([
				buildInstance("inst-1", "First Instance"),
			]);

			renderSessionPage("/session/main/__none__/__new__?instanceId=inst-1");

			await waitFor(() => {
				expect(
					screen.getByText("workspace-props:inst-1:main:none"),
				).toBeInTheDocument();
			});

			const streamShell = screen.getByTestId("session-stream-shell");
			expect(streamShell).toBeInTheDocument();
		});

		it("exposes session-input-shell testid on the input area", async () => {
			listInstancesMock.mockResolvedValue([
				buildInstance("inst-1", "First Instance"),
			]);

			renderSessionPage("/session/main/__none__/__new__?instanceId=inst-1");

			await waitFor(() => {
				expect(
					screen.getByText("workspace-props:inst-1:main:none"),
				).toBeInTheDocument();
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

			renderSessionPage("/session/main/__none__/__new__?instanceId=inst-1");

			await waitFor(() => {
				expect(
					screen.getByText("workspace-props:inst-1:main:none"),
				).toBeInTheDocument();
			});

			expect(screen.queryByRole("button", { name: /First Instance/ })).not.toBeInTheDocument();
			expect(screen.queryByRole("button", { name: /Second Instance/ })).not.toBeInTheDocument();
		});

		it("uses full-width desktop shell instead of centered max-width wrapper", async () => {
			listInstancesMock.mockResolvedValue([
				buildInstance("inst-1", "Full Width Instance"),
			]);

			renderSessionPage("/session/main/__none__/__new__?instanceId=inst-1");

			await waitFor(() => {
				expect(
					screen.getByText("workspace-props:inst-1:main:none"),
				).toBeInTheDocument();
			});

			const headerTitle = screen.getByRole("heading", {
				name: "Full Width Instance",
			});
			const headerInner = headerTitle.parentElement;
			expect(headerInner).not.toHaveStyle({ maxWidth: "880px" });

			const mainElement = screen
				.getByTestId("session-stream-shell")
				.closest("main");
			expect(mainElement).not.toBeNull();
			expect(mainElement).not.toHaveStyle({ justifyContent: "center" });
		});

	});
});
