import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../api/client";
import { AgentWorkspace } from "./AgentWorkspace";

const mockRealtimeClient = {
	connect: vi.fn(),
	close: vi.fn(),
};

const mockGetAgentDetail = vi.fn();
const mockListSessions = vi.fn();
const mockPreviewSessions = vi.fn();

vi.mock("../api/client", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../api/client")>();
	return {
		...actual,
		getAgentDetail: (...args: unknown[]) => mockGetAgentDetail(...args),
		getDefaultObserverDataSource: vi.fn().mockReturnValue("openclaw"),
		listSessions: (...args: unknown[]) => mockListSessions(...args),
		previewSessions: (...args: unknown[]) => mockPreviewSessions(...args),
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

describe("AgentWorkspace readonly mode", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetAgentDetail.mockResolvedValue({
			id: "main",
			name: "Main Agent",
			status: "running",
			is_active: true,
			root_node_id: "node-1",
			root_child_count: 2,
			total_node_count: 5,
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
				{
					key: "session-2",
					kind: "direct",
					label: "Session 2",
					derived_title: "Second Session",
					last_message_preview: null,
					updated_at: Date.parse("2026-03-24T05:28:00Z"),
				},
			],
			defaults: { model: "gpt-4" },
		});
		mockPreviewSessions.mockResolvedValue({
			ts: Date.parse("2026-03-24T05:31:00Z"),
			previews: [{ key: "session-1", status: "ok", items: [] }],
		});
	});

	it("shows collapsed disclosure and hides destructive session controls", async () => {
		render(<AgentWorkspace />);

		await waitFor(() => {
			expect(screen.getByTestId("session-input-shell")).toBeInTheDocument();
		});

		expect(screen.getByText(/observer-only/i)).toBeInTheDocument();
		expect(screen.getByText(/点击查看详情/i)).toBeInTheDocument();

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

	it("does not render tabs for status/logs/files", async () => {
		render(<AgentWorkspace />);

		await waitFor(() => {
			expect(screen.getByTestId("session-stream-shell")).toBeInTheDocument();
		});

		expect(screen.queryByRole("button", { name: /消息/i })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /状态/i })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /日志/i })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /文件/i })).not.toBeInTheDocument();
	});

	it("shows a loading state while the session shell is still fetching", () => {
		const deferred = createDeferredPromise();
		const sessionsDeferred = createDeferredPromise();
		mockGetAgentDetail.mockReturnValueOnce(deferred.promise);
		mockListSessions.mockReturnValueOnce(sessionsDeferred.promise);

		render(<AgentWorkspace />);

		expect(screen.getByTestId("session-stream-shell")).toBeInTheDocument();
		expect(screen.getByText("加载中...")).toBeInTheDocument();
	});

	it("shows request clues and an explicit empty workspace state when no sessions are available", async () => {
		mockListSessions.mockResolvedValueOnce({
			ts: Date.parse("2026-03-24T05:30:00Z"),
			sessions: [],
			defaults: { model: "gpt-4" },
		});

		render(<AgentWorkspace />);

		await waitFor(() => {
			expect(screen.getByText("请求线索")).toBeInTheDocument();
		});

		expect(
			screen.getByText(
				"read chain · getAgentDetail -> listSessions -> previewSessions (+ realtime after selection)",
			),
		).toBeInTheDocument();
		expect(
			screen.getByText("request_id · 当前真实读链路未返回 aggregate request_id"),
		).toBeInTheDocument();
		expect(
			screen.getByText("freshness · inferred fresh from listSessions.ts"),
		).toBeInTheDocument();
		expect(
			screen.getByText(
				"diagnostics · getAgentDetail ok · listSessions empty(0) · previewSessions skipped",
			),
		).toBeInTheDocument();
		expect(screen.getByText("当前工作区暂无可用会话")).toBeInTheDocument();
		expect(screen.queryByText("会话下游读取失败")).not.toBeInTheDocument();
	});

	it("surfaces downstream list failure as partial failure instead of swallowing it into an empty state", async () => {
		mockListSessions.mockRejectedValueOnce(new Error("session list unavailable"));

		render(<AgentWorkspace />);

		await waitFor(() => {
			expect(screen.getByText("会话下游读取失败")).toBeInTheDocument();
		});

		expect(
			within(screen.getByTestId("session-list-area")).getByText(
				"会话列表读取失败：session list unavailable",
			),
		).toBeInTheDocument();
		expect(
			within(screen.getByTestId("session-conversation-area")).getByText(
				"当前会话列表不可用",
			),
		).toBeInTheDocument();
		expect(
			screen.getByText(
				"diagnostics · getAgentDetail ok · listSessions failed · previewSessions skipped",
			),
		).toBeInTheDocument();
		expect(screen.queryByText("当前工作区暂无可用会话")).not.toBeInTheDocument();
	});

	it("surfaces downstream preview failure with the selected session still visible", async () => {
		mockPreviewSessions.mockRejectedValueOnce(new Error("preview unavailable"));

		render(<AgentWorkspace />);

		await waitFor(() => {
			expect(screen.getByText("会话下游读取失败")).toBeInTheDocument();
		});

		expect(screen.getByRole("button", { name: "First Session" })).toBeInTheDocument();
		expect(
			within(screen.getByTestId("session-conversation-area")).getByText(
				"当前会话预览不可用",
			),
		).toBeInTheDocument();
		expect(
			within(screen.getByTestId("session-conversation-area")).getByText(
				"previewSessions 失败：preview unavailable",
			),
		).toBeInTheDocument();
		expect(
			screen.getByText(
				"diagnostics · getAgentDetail ok · listSessions ok(2) · previewSessions failed",
			),
		).toBeInTheDocument();
	});

	it("shows an explicit failed state when the core agent shell cannot be established", async () => {
		mockGetAgentDetail.mockRejectedValueOnce(new Error("agent snapshot unavailable"));

		render(<AgentWorkspace />);

		await waitFor(() => {
			expect(screen.getByText("会话工作区暂时不可用")).toBeInTheDocument();
		});

		expect(screen.getByText("getAgentDetail 失败：agent snapshot unavailable")).toBeInTheDocument();
		expect(screen.getByText("诊断状态 · failed")).toBeInTheDocument();
		expect(screen.queryByText("当前无权查看该会话工作区")).not.toBeInTheDocument();
	});

	it("shows an explicit unauthorized state and keeps the input zone readonly with a visible reason", async () => {
		mockGetAgentDetail.mockRejectedValueOnce(
			new ApiError(401, "Unauthorized", {
				code: "unauthorized",
				message: "当前账号缺少 session 读取权限",
				request_id: "req-session-401",
				recoverable: true,
				next_step: "重新登录后重试",
			}),
		);

		render(<AgentWorkspace />);

		await waitFor(() => {
			expect(screen.getByText("当前无权查看该会话工作区")).toBeInTheDocument();
		});

		expect(screen.getByText("request_id · req-session-401")).toBeInTheDocument();
		expect(screen.getByText("diagnostic_reason · 当前账号缺少 session 读取权限")).toBeInTheDocument();
		expect(screen.getByText("重新登录后重试")).toBeInTheDocument();
		expect(screen.getByTestId("session-input-shell")).toHaveAttribute(
			"aria-disabled",
			"true",
		);
		expect(screen.getByText("输入区保持只读：当前账号缺少 session 读取权限")).toBeInTheDocument();
	});

	it("truthfully marks stale state from aged preview timestamp instead of inventing aggregate freshness", async () => {
		const dateNowSpy = vi
			.spyOn(Date, "now")
			.mockReturnValue(Date.parse("2026-03-24T05:40:30Z"));
		mockPreviewSessions.mockResolvedValueOnce({
			ts: Date.parse("2026-03-24T05:31:00Z"),
			previews: [{ key: "session-1", status: "ok", items: [] }],
		});

		render(<AgentWorkspace />);

		await waitFor(() => {
			expect(
				screen.getByText("freshness · inferred stale from previewSessions.ts"),
			).toBeInTheDocument();
		});

		expect(screen.getByText("当前展示的是推断滞后数据")).toBeInTheDocument();
		expect(
			screen.getByText("freshness · inferred stale from previewSessions.ts"),
		).toBeInTheDocument();
		expect(
			screen.getByText("当前 session 没有 aggregate freshness；此处仅根据最近一次 list/preview ts 推断。"),
		).toBeInTheDocument();

		dateNowSpy.mockRestore();
	});
});

describe("AgentWorkspace five-block structure", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders agent header with agent id", async () => {
		render(<AgentWorkspace />);

		await waitFor(() => {
			expect(screen.getByTestId("agent-header")).toBeInTheDocument();
		});

		expect(screen.getByTestId("agent-header")).toBeInTheDocument();
	});

	it("renders left sidebar with channel area above session area", async () => {
		render(<AgentWorkspace />);

		await waitFor(() => {
			expect(screen.getByTestId("session-left-sidebar")).toBeInTheDocument();
		});

		const leftSidebar = screen.getByTestId("session-left-sidebar");
		expect(leftSidebar).toBeInTheDocument();

		const channelArea = screen.getByTestId("session-channel-area");
		expect(channelArea).toBeInTheDocument();

		const sessionArea = screen.getByTestId("session-list-area");
		expect(sessionArea).toBeInTheDocument();

		const sidebarChildren = Array.from(leftSidebar.children);
		const channelIndex = sidebarChildren.indexOf(channelArea);
		const sessionIndex = sidebarChildren.indexOf(sessionArea);
		expect(channelIndex).toBeLessThan(sessionIndex);
	});

	it("renders current conversation area", async () => {
		render(<AgentWorkspace />);

		await waitFor(() => {
			expect(screen.getByTestId("session-conversation-area")).toBeInTheDocument();
		});

		expect(screen.getByTestId("session-conversation-area")).toBeInTheDocument();
	});

	it("renders input/send area with readonly explanation", async () => {
		render(<AgentWorkspace />);

		await waitFor(() => {
			expect(screen.getByTestId("session-input-shell")).toBeInTheDocument();
		});

		const inputShell = screen.getByTestId("session-input-shell");
		expect(inputShell).toBeInTheDocument();

		expect(screen.getByText(/observer-only/i)).toBeInTheDocument();
	});

	it("renders all five structural areas visible in workspace", async () => {
		render(<AgentWorkspace />);

		await waitFor(() => {
			expect(screen.getByTestId("agent-header")).toBeInTheDocument();
		});

		expect(screen.getByTestId("agent-header")).toBeInTheDocument();
		expect(screen.getByTestId("session-channel-area")).toBeInTheDocument();
		expect(screen.getByTestId("session-list-area")).toBeInTheDocument();
		expect(screen.getByTestId("session-conversation-area")).toBeInTheDocument();
		expect(screen.getByTestId("session-input-shell")).toBeInTheDocument();
	});
});

function createDeferredPromise<T = unknown>(): {
	promise: Promise<T>;
	resolve: (value: T | PromiseLike<T>) => void;
	reject: (reason?: unknown) => void;
} {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}
