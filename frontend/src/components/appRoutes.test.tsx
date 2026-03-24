import "@testing-library/jest-dom";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { Outlet } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../hooks/useAuth", () => ({
	AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../hooks/useToast", () => ({
	ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../routes", () => ({
	ProtectedRoute: () => <Outlet />,
	PublicRoute: () => <Outlet />,
}));

vi.mock("./Layout", () => ({
	Layout: () => <Outlet />,
	RedirectToOverview: () => <div>redirect-overview</div>,
}));

vi.mock("./CollabPage", () => ({
	default: () => <div>kanban-page</div>,
}));

vi.mock("./LoginPage", () => ({
	LoginPage: () => <div>login-page</div>,
}));

vi.mock("./OverviewPage", () => ({
	OverviewPage: () => <div>overview-page</div>,
}));

vi.mock("./TopologyPage", () => ({
	TopologyPage: () => <div>topology-page</div>,
}));

vi.mock("./SessionPage", () => ({
	default: () => <div>session-page</div>,
}));

vi.mock(
	"./TeamPage",
	() => ({
		TeamPage: () => <div>team-page</div>,
	}),
);

describe("app routes", () => {
	afterEach(() => {
		cleanup();
		vi.resetModules();
		document.body.innerHTML = "";
		window.history.pushState({}, "", "/");
	});

	it("does not preserve /collab as a live app route", async () => {
		document.body.innerHTML = '<div id="root"></div>';
		window.history.pushState({}, "", "/collab");

		await act(async () => {
			await import("../main");
		});

		await waitFor(() => {
			expect(window.location.pathname).toBe("/login");
		});

		expect(screen.getByText("login-page")).toBeInTheDocument();
		expect(screen.queryByText("kanban-page")).not.toBeInTheDocument();
	});

	it("renders /team as a first-class app route", async () => {
		document.body.innerHTML = '<div id="root"></div>';
		window.history.pushState({}, "", "/team");

		await act(async () => {
			await import("../main");
		});

		await waitFor(() => {
			expect(window.location.pathname).toBe("/team");
		});

		expect(screen.getByText("team-page")).toBeInTheDocument();
	});

	it("does not preserve legacy /session/:instanceId app entrypoints", async () => {
		document.body.innerHTML = '<div id="root"></div>';
		window.history.pushState({}, "", "/session/inst-2");

		await act(async () => {
			await import("../main");
		});

		await waitFor(() => {
			expect(window.location.pathname).toBe("/login");
		});

		expect(screen.getByText("login-page")).toBeInTheDocument();
		expect(screen.queryByText("session-page")).not.toBeInTheDocument();
	});

	it("renders canonical /session/:agentId/:channelKey/:sessionKey route", async () => {
		document.body.innerHTML = '<div id="root"></div>';
		window.history.pushState({}, "", "/session/main/__none__/__new__");

		await act(async () => {
			await import("../main");
		});

		await waitFor(() => {
			expect(window.location.pathname).toBe("/session/main/__none__/__new__");
		});

		expect(screen.getByText("session-page")).toBeInTheDocument();
	});
});
