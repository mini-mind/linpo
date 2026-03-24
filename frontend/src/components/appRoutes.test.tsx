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

	it("redirects /collab to /kanban and renders kanban page", async () => {
		document.body.innerHTML = '<div id="root"></div>';
		window.history.pushState({}, "", "/collab");

		await act(async () => {
			await import("../main");
		});

		await waitFor(() => {
			expect(window.location.pathname).toBe("/kanban");
		});

		expect(screen.getByText("kanban-page")).toBeInTheDocument();
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
});
