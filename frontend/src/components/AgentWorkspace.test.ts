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
