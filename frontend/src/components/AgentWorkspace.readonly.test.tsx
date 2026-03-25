import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
const mockSendChatMessage = vi.fn();
const mockPauseSession = vi.fn();
const mockResetSession = vi.fn();
const mockDeleteSession = vi.fn();

vi.mock("../api/client", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../api/client")>();
	return {
		...actual,
		getAgentDetail: (...args: unknown[]) => mockGetAgentDetail(...args),
		getDefaultObserverDataSource: vi.fn().mockReturnValue("openclaw"),
		listSessions: (...args: unknown[]) => mockListSessions(...args),
		previewSessions: (...args: unknown[]) => mockPreviewSessions(...args),
		sendChatMessage: (...args: unknown[]) => mockSendChatMessage(...args),
		pauseSession: (...args: unknown[]) => mockPauseSession(...args),
		resetSession: (...args: unknown[]) => mockResetSession(...args),
		deleteSession: (...args: unknown[]) => mockDeleteSession(...args),
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

describe("AgentWorkspace session workspace", () => {
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
		mockSendChatMessage.mockResolvedValue({
			request_id: "req-send-1",
			agent_id: "main",
			status: "queued",
		});
		mockPauseSession.mockResolvedValue({ paused: true });
		mockResetSession.mockResolvedValue({ reset: true });
		mockDeleteSession.mockResolvedValue({ deleted: true });
	});

	it("shows chat input and real session action controls", async () => {
		render(<AgentWorkspace />);

		await waitFor(() => {
			expect(screen.getByTestId("session-input-shell")).toBeInTheDocument();
		});

		expect(screen.getByLabelText("消息输入")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /^发送$/i })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /^暂停$/i })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /^重置会话$/i })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /^删除会话$/i })).toBeInTheDocument();
	});

	it("sends message through send API and clears input after success", async () => {
		render(<AgentWorkspace />);

		await waitFor(() => {
			expect(screen.getByLabelText("消息输入")).toBeInTheDocument();
		});

		const input = screen.getByLabelText("消息输入");
		const sendButton = screen.getByRole("button", { name: /^发送$/i });

		await userEvent.type(input, "你好\n第二行");
		await userEvent.click(sendButton);

		await waitFor(() => {
			expect(mockSendChatMessage).toHaveBeenCalledWith(
				{
					agentId: "main",
					sessionKey: "session-1",
					message: "你好\n第二行",
				},
				{ instanceId: null },
			);
		});
		expect(input).toHaveValue("");
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

	it("does not render request clues block and keeps explicit empty workspace state when no sessions are available", async () => {
		mockListSessions.mockResolvedValueOnce({
			ts: Date.parse("2026-03-24T05:30:00Z"),
			sessions: [],
			defaults: { model: "gpt-4" },
		});

		render(<AgentWorkspace />);

		await waitFor(() => {
			expect(screen.getByTestId("session-conversation-area")).toBeInTheDocument();
		});

		expect(screen.queryByText("请求线索")).not.toBeInTheDocument();
		expect(screen.getByText("当前工作区暂无可用会话")).toBeInTheDocument();
		expect(screen.queryByText("会话下游读取失败")).not.toBeInTheDocument();
	});

	it("writes request/freshness/diagnostics clues to console instead of page block", async () => {
		const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

		try {
			render(<AgentWorkspace />);

			await waitFor(() => {
				expect(screen.getByTestId("session-conversation-area")).toBeInTheDocument();
			});

			await waitFor(() => {
				expect(infoSpy).toHaveBeenCalled();
			});

			const output = infoSpy.mock.calls.flat().map(String).join(" ");
			expect(output).toContain("request");
			expect(output).toContain("freshness");
			expect(output).toContain("diagnostics");
		} finally {
			infoSpy.mockRestore();
		}
	});

	it("targets a doubao-like layout with full-width shell but narrowed center conversation column", async () => {
		mockPreviewSessions.mockResolvedValue({
			ts: Date.parse("2026-03-24T05:31:00Z"),
			previews: [
				{
					key: "session-1",
					status: "ok",
					items: [{ role: "user", text: "doubao 样式约束" }],
				},
			],
		});

		render(<AgentWorkspace />);

		await waitFor(() => {
			expect(screen.getByTestId("session-conversation-area")).toBeInTheDocument();
		});

		const streamShell = screen.getByTestId("session-stream-shell");
		const leftSidebar = screen.getByTestId("session-left-sidebar");
		const conversationArea = screen.getByTestId("session-conversation-area");
		const inputShell = screen.getByTestId("session-input-shell");
		const composerInput = screen.getByLabelText("消息输入");

		const userRoleLabel = await within(conversationArea).findByText("用户");
		const userBubble = userRoleLabel.parentElement;
		expect(userBubble).not.toBeNull();

		expect(streamShell.style.width).toBe("100%");
		expect(streamShell.style.maxWidth).toBe("none");
		expect(streamShell.style.marginLeft).toBe("0px");
		expect(streamShell.style.marginRight).toBe("0px");

		expect(leftSidebar.style.marginLeft).toBe("0px");
		expect(leftSidebar.style.paddingLeft).toBe("0px");
		expect(leftSidebar.style.paddingRight).toBe("0px");

		expect(conversationArea.style.width).toBe("100%");
		expect(conversationArea.style.maxWidth).toBe("960px");
		expect(conversationArea.style.marginLeft).toBe("auto");
		expect(conversationArea.style.marginRight).toBe("auto");
		expect(conversationArea.style.paddingLeft).toBe("0px");
		expect(conversationArea.style.paddingRight).toBe("0px");
		expect(conversationArea.style.background).toBe("#fff");
		const messageViewport = conversationArea.firstElementChild as HTMLElement | null;
		expect(messageViewport).not.toBeNull();
		expect(messageViewport?.style.overflow).toBe("auto");

		expect(inputShell.style.maxWidth).toBe("960px");
		expect(inputShell.style.marginLeft).toBe("auto");
		expect(inputShell.style.marginRight).toBe("auto");
		expect(inputShell.style.paddingLeft).toBe("0px");
		expect(inputShell.style.paddingRight).toBe("0px");
		expect(inputShell.style.borderTop).toContain("none");
		expect(inputShell.style.border).toContain("none");
		expect(inputShell.style.boxShadow).toBe("none");
		expect(composerInput).toHaveStyle({ border: "1px solid #e2e8f0" });

		expect(userBubble?.style.borderRadius).toBe("18px");
		expect(userBubble?.style.maxWidth).toBe("78%");
	});

	it("surfaces downstream list failure as partial failure instead of swallowing it into an empty state", async () => {
		const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
		mockListSessions.mockRejectedValueOnce(new Error("session list unavailable"));

		try {
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
			expect(screen.queryByText("当前工作区暂无可用会话")).not.toBeInTheDocument();

			await waitFor(() => {
				expect(infoSpy).toHaveBeenCalled();
			});
			const payloads = infoSpy.mock.calls
				.map((call) => call[1])
				.filter((value): value is { diagnostics?: string } =>
					typeof value === "object" && value !== null,
				);
			expect(
				payloads.some((payload) => payload.diagnostics?.includes("listSessions failed")),
			).toBe(true);
		} finally {
			infoSpy.mockRestore();
		}
	});

	it("surfaces downstream preview failure with the selected session still visible", async () => {
		const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
		mockPreviewSessions.mockRejectedValueOnce(new Error("preview unavailable"));

		try {
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

			await waitFor(() => {
				expect(infoSpy).toHaveBeenCalled();
			});
			const payloads = infoSpy.mock.calls
				.map((call) => call[1])
				.filter((value): value is { diagnostics?: string } =>
					typeof value === "object" && value !== null,
				);
			expect(
				payloads.some((payload) => payload.diagnostics?.includes("previewSessions failed")),
			).toBe(true);
		} finally {
			infoSpy.mockRestore();
		}
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
		const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
		mockGetAgentDetail.mockRejectedValueOnce(
			new ApiError(401, "Unauthorized", {
				code: "unauthorized",
				message: "当前账号缺少 session 读取权限",
				request_id: "req-session-401",
				recoverable: true,
				next_step: "重新登录后重试",
			}),
		);

		try {
			render(<AgentWorkspace />);

			await waitFor(() => {
				expect(screen.getByText("当前无权查看该会话工作区")).toBeInTheDocument();
			});

			expect(screen.getByText("重新登录后重试")).toBeInTheDocument();
			expect(screen.getByTestId("session-input-shell")).toHaveAttribute(
				"aria-disabled",
				"true",
			);
			expect(screen.getByText("输入区保持只读：当前账号缺少 session 读取权限")).toBeInTheDocument();

			await waitFor(() => {
				expect(infoSpy).toHaveBeenCalled();
			});
			const payloads = infoSpy.mock.calls
				.map((call) => call[1])
				.filter(
					(
						value,
					): value is { request?: string; diagnosticReason?: string | null } =>
						typeof value === "object" && value !== null,
				);
			expect(payloads.some((payload) => payload.request === "req-session-401")).toBe(
				true,
			);
			expect(
				payloads.some(
					(payload) => payload.diagnosticReason === "当前账号缺少 session 读取权限",
				),
			).toBe(true);
		} finally {
			infoSpy.mockRestore();
		}
	});

	it("truthfully marks stale state from aged preview timestamp instead of inventing aggregate freshness", async () => {
		const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
		const dateNowSpy = vi
			.spyOn(Date, "now")
			.mockReturnValue(Date.parse("2026-03-24T05:40:30Z"));
		mockListSessions.mockResolvedValueOnce({
			ts: Date.parse("2026-03-24T05:40:20Z"),
			sessions: [
				{
					key: "session-1",
					kind: "direct",
					label: "Session 1",
					derived_title: "First Session",
					last_message_preview: null,
					updated_at: Date.parse("2026-03-24T05:40:19Z"),
				},
			],
			defaults: { model: "gpt-4" },
		});
		mockPreviewSessions.mockResolvedValueOnce({
			ts: Date.parse("2026-03-24T05:31:00Z"),
			previews: [{ key: "session-1", status: "ok", items: [] }],
		});

		try {
			render(<AgentWorkspace />);

			await waitFor(() => {
				expect(screen.getByText("当前展示的是推断滞后数据")).toBeInTheDocument();
			});

			expect(
				screen.getByText("当前 session 没有 aggregate freshness；此处仅根据最近一次 list/preview ts 推断。"),
			).toBeInTheDocument();

			await waitFor(() => {
				expect(infoSpy).toHaveBeenCalled();
			});
			const payloads = infoSpy.mock.calls
				.map((call) => call[1])
				.filter((value): value is { freshness?: string } =>
					typeof value === "object" && value !== null,
				);
			expect(
				payloads.some((payload) => payload.freshness === "inferred stale from previewSessions.ts"),
			).toBe(true);
		} finally {
			dateNowSpy.mockRestore();
			infoSpy.mockRestore();
		}
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

	it("renders input/send area", async () => {
		render(<AgentWorkspace />);

		await waitFor(() => {
			expect(screen.getByTestId("session-input-shell")).toBeInTheDocument();
		});

		const inputShell = screen.getByTestId("session-input-shell");
		expect(inputShell).toBeInTheDocument();
		expect(screen.getByLabelText("消息输入")).toBeInTheDocument();
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
