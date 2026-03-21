import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentWorkspace } from "./AgentWorkspace";

const mockRealtimeClient = {
	connect: vi.fn(),
	close: vi.fn(),
};

vi.mock("../api/client", () => ({
	deleteSession: vi.fn(),
	getAgentDetail: vi.fn().mockResolvedValue({
		id: "main",
		status: "running",
		is_active: true,
		root_node_id: "node-1",
		root_child_count: 2,
		total_node_count: 5,
		nodes: [
			{
				id: "node-1",
				name: "root",
				type: "agent",
				status: "running",
				parent_id: null,
			},
		],
	}),
	getNodeDetail: vi.fn().mockResolvedValue({
		id: "node-1",
		events: [],
	}),
	getDefaultObserverDataSource: vi.fn().mockReturnValue("openclaw"),
	listModels: vi.fn().mockResolvedValue([{ id: "gpt-4", name: "GPT-4" }]),
	listSessions: vi.fn().mockResolvedValue({
		sessions: [{ key: "session-1", name: "Session 1" }],
		defaults: { model: "gpt-4" },
	}),
	patchSession: vi.fn(),
	previewSessions: vi.fn().mockResolvedValue({
		ts: 1,
		previews: [{ key: "session-1", status: "ok", items: [] }],
	}),
	resetSession: vi.fn(),
	sendControlRequest: vi.fn(),
	sendMessage: vi.fn(),
}));

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

describe("AgentWorkspace readonly mode", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("shows readonly hint and hides destructive session controls", async () => {
		render(<AgentWorkspace />);

		await waitFor(() => {
			expect(
				screen.getByText(/当前阶段仅保留观察与进入能力/i),
			).toBeInTheDocument();
		});

		expect(
			screen.queryByRole("button", { name: /暂停/i }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /重置会话/i }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /删除会话/i }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /^发送$/i }),
		).not.toBeInTheDocument();
		expect(screen.queryByLabelText("消息输入")).not.toBeInTheDocument();
	});
});
