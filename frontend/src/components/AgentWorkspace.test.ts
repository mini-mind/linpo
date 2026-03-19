import { beforeAll, describe, expect, it, vi } from "vitest";

type AgentWorkspaceModule = typeof import("./AgentWorkspace");

let agentWorkspaceModule: AgentWorkspaceModule;

beforeAll(async () => {
	vi.stubGlobal("window", {
		location: {
			protocol: "http:",
			host: "linpo.test",
		},
	});

	agentWorkspaceModule = await import("./AgentWorkspace");
});

describe("AgentWorkspace session selection helpers", () => {
	it("prefers the next session after deleting the current one", () => {
		const { getFallbackSessionKeyAfterDelete } = agentWorkspaceModule;
		const sessions = [
			{ key: "session-1" },
			{ key: "session-2" },
			{ key: "session-3" },
		] as const;

		expect(getFallbackSessionKeyAfterDelete(sessions, "session-2")).toBe(
			"session-3",
		);
	});

	it("falls back to the previous session when deleting the last one", () => {
		const { getFallbackSessionKeyAfterDelete } = agentWorkspaceModule;
		const sessions = [
			{ key: "session-1" },
			{ key: "session-2" },
		] as const;

		expect(getFallbackSessionKeyAfterDelete(sessions, "session-2")).toBe(
			"session-1",
		);
	});

	it("returns null when deleting the only session", () => {
		const { getFallbackSessionKeyAfterDelete } = agentWorkspaceModule;
		const sessions = [{ key: "session-1" }] as const;

		expect(getFallbackSessionKeyAfterDelete(sessions, "session-1")).toBeNull();
	});

	it("keeps the current session when it still exists after refresh", () => {
		const { resolveSelectedSessionKey } = agentWorkspaceModule;
		const sessions = [{ key: "session-1" }, { key: "session-2" }] as const;

		expect(resolveSelectedSessionKey(sessions, "session-2", null)).toBe(
			"session-2",
		);
	});

	it("uses the preferred fallback when it exists in refreshed sessions", () => {
		const { resolveSelectedSessionKey } = agentWorkspaceModule;
		const sessions = [{ key: "session-1" }, { key: "session-3" }] as const;

		expect(resolveSelectedSessionKey(sessions, "session-2", "session-3")).toBe(
			"session-3",
		);
	});
});

describe("AgentWorkspace preview helpers", () => {
	it("returns preview items for an ok response", () => {
		const { getPreviewItemsForSession } = agentWorkspaceModule;
		expect(
			getPreviewItemsForSession(
				{
					ts: 1,
					previews: [
						{
							key: "session-1",
							status: "ok",
							items: [{ role: "assistant", text: "hello" }],
						},
					],
				},
				"session-1",
			),
		).toEqual([{ role: "assistant", text: "hello" }]);
	});

	it("returns an empty list for missing or empty previews", () => {
		const { getPreviewItemsForSession } = agentWorkspaceModule;
		expect(
			getPreviewItemsForSession(
				{
					ts: 1,
					previews: [{ key: "session-1", status: "missing", items: [] }],
				},
				"session-1",
			),
		).toEqual([]);
	});
});


describe("AgentWorkspace preview equality helpers", () => {
	it("returns true when two preview lists have identical content", () => {
		const { arePreviewItemsEqual } = agentWorkspaceModule;
		expect(
			arePreviewItemsEqual(
				[
					{ role: "user", text: "你好" },
					{ role: "assistant", text: "在的" },
				],
				[
					{ role: "user", text: "你好" },
					{ role: "assistant", text: "在的" },
				],
			),
		).toBe(true);
	});

	it("returns false when preview message order or text differs", () => {
		const { arePreviewItemsEqual } = agentWorkspaceModule;
		expect(
			arePreviewItemsEqual(
				[
					{ role: "user", text: "你好" },
					{ role: "assistant", text: "在的" },
				],
				[
					{ role: "user", text: "你好" },
					{ role: "assistant", text: "请讲" },
				],
			),
		).toBe(false);
	});
});


describe("AgentWorkspace realtime preview merge helpers", () => {
	it("keeps history and updates the last assistant message when streaming", () => {
		const { mergePreviewItemsFromRealtime } = agentWorkspaceModule;
		expect(
			mergePreviewItemsFromRealtime(
				[
					{ role: "user", text: "你好" },
					{ role: "assistant", text: "正在" },
				],
				[{ role: "assistant", text: "正在生成" }],
			),
		).toEqual([
			{ role: "user", text: "你好" },
			{ role: "assistant", text: "正在生成" },
		]);
	});

	it("appends streaming assistant message when last message is not assistant", () => {
		const { mergePreviewItemsFromRealtime } = agentWorkspaceModule;
		expect(
			mergePreviewItemsFromRealtime(
				[{ role: "user", text: "继续" }],
				[{ role: "assistant", text: "好的" }],
			),
		).toEqual([
			{ role: "user", text: "继续" },
			{ role: "assistant", text: "好的" },
		]);
	});

	it("concatenates delta chunks for streaming assistant text", () => {
		const { mergeStreamingAssistantText } = agentWorkspaceModule;
		expect(mergeStreamingAssistantText("Hello", " world")).toBe("Hello world");
		expect(mergeStreamingAssistantText("Hello", "Hello world")).toBe(
			"Hello world",
		);
	});
});

describe("AgentWorkspace session model helpers", () => {
	it("gets the model for a specific session key", () => {
		const { getSessionModel } = agentWorkspaceModule;
		const sessionModels: Record<string, string> = {
			"session-1": "model-a",
			"session-2": "model-b",
		};

		expect(getSessionModel(sessionModels, "session-1", null)).toBe("model-a");
		expect(getSessionModel(sessionModels, "session-2", null)).toBe("model-b");
	});

	it("falls back to default model when session has no recorded model", () => {
		const { getSessionModel } = agentWorkspaceModule;
		const sessionModels: Record<string, string> = {
			"session-1": "model-a",
		};

		expect(getSessionModel(sessionModels, "session-2", "default-model")).toBe("default-model");
	});

	it("returns null when no session model and no default", () => {
		const { getSessionModel } = agentWorkspaceModule;
		const sessionModels: Record<string, string> = {};

		expect(getSessionModel(sessionModels, "session-1", null)).toBeNull();
	});

	it("updates model for a specific session key", () => {
		const { updateSessionModel } = agentWorkspaceModule;
		const sessionModels: Record<string, string> = {
			"session-1": "model-a",
		};

		const updated = updateSessionModel(sessionModels, "session-1", "model-c");
		expect(updated["session-1"]).toBe("model-c");
	});

	it("adds new session model when updating unknown session", () => {
		const { updateSessionModel } = agentWorkspaceModule;
		const sessionModels: Record<string, string> = {
			"session-1": "model-a",
		};

		const updated = updateSessionModel(sessionModels, "session-2", "model-b");
		expect(updated["session-2"]).toBe("model-b");
		expect(updated["session-1"]).toBe("model-a");
	});

	it("simulates session switching with per-session models", () => {
		const { getSessionModel, updateSessionModel } = agentWorkspaceModule;
		
		let sessionModels: Record<string, string> = {
			"session-1": "default-model",
			"session-2": "default-model",
		};

		sessionModels = updateSessionModel(sessionModels, "session-1", "model-x");
		expect(getSessionModel(sessionModels, "session-1", null)).toBe("model-x");
		expect(getSessionModel(sessionModels, "session-2", null)).toBe("default-model");
		expect(getSessionModel(sessionModels, "session-1", null)).toBe("model-x");

		sessionModels = updateSessionModel(sessionModels, "session-2", "model-y");
		expect(getSessionModel(sessionModels, "session-2", null)).toBe("model-y");
		expect(getSessionModel(sessionModels, "session-1", null)).toBe("model-x");
	});

	it("proves model state is not global by showing different sessions have different models", () => {
		const { getSessionModel } = agentWorkspaceModule;
		
		const sessionModels: Record<string, string> = {
			"session-a": "gpt-4",
			"session-b": "claude-3",
			"session-c": "gpt-3.5-turbo",
		};

		expect(getSessionModel(sessionModels, "session-a", null)).toBe("gpt-4");
		expect(getSessionModel(sessionModels, "session-b", null)).toBe("claude-3");
		expect(getSessionModel(sessionModels, "session-c", null)).toBe("gpt-3.5-turbo");
		expect(getSessionModel(sessionModels, "session-a", null)).not.toBe(
			getSessionModel(sessionModels, "session-b", null)
		);
	});
});

describe("AgentWorkspace model update status race condition", () => {
	it("shows status when update session matches current session", () => {
		const { shouldShowModelUpdateStatus } = agentWorkspaceModule;

		expect(shouldShowModelUpdateStatus("updating", "session-1", "session-1")).toBe(true);
		expect(shouldShowModelUpdateStatus("success", "session-1", "session-1")).toBe(true);
		expect(shouldShowModelUpdateStatus("failed", "session-1", "session-1")).toBe(true);
	});

	it("hides status when update session differs from current session", () => {
		const { shouldShowModelUpdateStatus } = agentWorkspaceModule;

		expect(shouldShowModelUpdateStatus("updating", "session-1", "session-2")).toBe(false);
		expect(shouldShowModelUpdateStatus("success", "session-1", "session-2")).toBe(false);
		expect(shouldShowModelUpdateStatus("failed", "session-1", "session-2")).toBe(false);
	});

	it("hides status when status is idle", () => {
		const { shouldShowModelUpdateStatus } = agentWorkspaceModule;

		expect(shouldShowModelUpdateStatus("idle", "session-1", "session-1")).toBe(false);
		expect(shouldShowModelUpdateStatus("idle", "session-1", "session-2")).toBe(false);
		expect(shouldShowModelUpdateStatus("idle", null, null)).toBe(false);
	});

	it("simulates race condition: user switches session during in-flight update", () => {
		const { shouldShowModelUpdateStatus, updateSessionModel, getSessionModel } = agentWorkspaceModule;

		let sessionModels: Record<string, string> = {
			"session-1": "model-a",
			"session-2": "model-b",
		};

		let currentSessionKey: string | null = "session-1";
		let modelUpdateStatus: "idle" | "updating" | "success" | "failed" = "updating";
		const modelUpdateSessionKey: string | null = "session-1";

		expect(shouldShowModelUpdateStatus(modelUpdateStatus, modelUpdateSessionKey, currentSessionKey)).toBe(true);

		sessionModels = updateSessionModel(sessionModels, "session-1", "model-x");

		currentSessionKey = "session-2";
		expect(shouldShowModelUpdateStatus(modelUpdateStatus, modelUpdateSessionKey, currentSessionKey)).toBe(false);

		modelUpdateStatus = "success";
		expect(shouldShowModelUpdateStatus(modelUpdateStatus, modelUpdateSessionKey, currentSessionKey)).toBe(false);

		expect(getSessionModel(sessionModels, "session-1", null)).toBe("model-x");
		expect(getSessionModel(sessionModels, "session-2", null)).toBe("model-b");
	});
});
