import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentWorkspace } from "./AgentWorkspace";

const mockRealtimeClient = {
	connect: vi.fn(),
	close: vi.fn(),
};

const mockGetAgentDetail = vi.fn();
const mockListSessions = vi.fn();
const mockGetSessionHistory = vi.fn();

vi.mock("../api/client", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../api/client")>();
	return {
		...actual,
		getAgentDetail: (...args: unknown[]) => mockGetAgentDetail(...args),
		getDefaultObserverDataSource: vi.fn().mockReturnValue("openclaw"),
		listSessions: (...args: unknown[]) => mockListSessions(...args),
		getSessionHistory: (...args: unknown[]) => mockGetSessionHistory(...args),
	};
});

vi.mock("../api/realtimeClient", () => ({
	createObserverRealtimeClient: vi.fn(() => mockRealtimeClient),
	buildAgentDetailChannel: vi.fn().mockReturnValue("agent:main"),
	buildSessionMessagesChannel: vi.fn().mockReturnValue("session:session-1"),
}));

vi.mock("../hooks/useIsMobile", () => ({
	useIsMobile: () => false,
}));

vi.mock("../hooks/useToast", () => ({
	useToast: () => ({
		addToast: vi.fn(),
	}),
}));

vi.mock("react-router-dom", () => ({
	useParams: () => ({
		agentId: "main",
	}),
}));

describe("AgentWorkspace markdown rendering", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetAgentDetail.mockResolvedValue({
			id: "main",
			name: "Main Agent",
			status: "running",
			is_active: true,
			root_node_id: "node-1",
			root_child_count: 1,
			total_node_count: 1,
			last_active_at: "2026-03-24T05:30:00Z",
			nodes: [
				{
					id: "node-1",
					name: "root",
					status: "running",
					is_active: true,
					child_count: 0,
					parent_id: null,
				},
			],
		});
		mockListSessions.mockResolvedValue({
			ts: Date.parse("2026-03-24T05:30:00Z"),
			sessions: [
				{
					key: "session-1",
					kind: "direct",
					label: "Session 1",
					derived_title: "First Session",
					last_message_preview: null,
					updated_at: Date.parse("2026-03-24T05:29:00Z"),
				},
			],
			defaults: { model: "gpt-4" },
		});
		mockGetSessionHistory.mockResolvedValue({
			ts: Date.parse("2026-03-24T05:31:00Z"),
			items: [
				{
					role: "assistant",
					text: "Hello **world** <img src=x onerror=alert(1) />",
				},
			],
		});
	});

	it("renders markdown emphasis but does not inject raw HTML", async () => {
		render(<AgentWorkspace />);

		await waitFor(() => {
			expect(screen.getByTestId("session-conversation-area")).toBeInTheDocument();
		});

		const world = await screen.findByText("world");
		expect(world.tagName).toBe("STRONG");

		const conversationArea = screen.getByTestId("session-conversation-area");
		expect(within(conversationArea).queryByRole("img")).not.toBeInTheDocument();
	});
});
