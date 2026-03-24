import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../api/client";
import type { AggregateOverviewResponse } from "../api/types";
import { buildSessionEntryPath } from "./SessionPage";
import { TeamPage } from "./TeamPage";

const { mockGetAggregateOverview, mockListSessions, mockPreviewSessions } =
	vi.hoisted(() => ({
		mockGetAggregateOverview: vi.fn(),
		mockListSessions: vi.fn(),
		mockPreviewSessions: vi.fn(),
	}));

vi.mock("../api/client", async () => {
	const actual =
		await vi.importActual<typeof import("../api/client")>("../api/client");
	return {
		...actual,
		getAggregateOverview: mockGetAggregateOverview,
		listSessions: mockListSessions,
		previewSessions: mockPreviewSessions,
	};
});

vi.mock("../hooks/useIsMobile", () => ({
	useIsMobile: () => false,
}));

const alphaOpeningText =
	"Alpha kickoff opened with a checklist that should be truncated into the card body for scanning.";
const betaOpeningText =
	"Beta review started by collecting blockers before dispatching the next execution window.";

function buildOverview(
	overrides: Partial<AggregateOverviewResponse> = {},
): AggregateOverviewResponse {
	return {
		...overviewFixture,
		...overrides,
	};
}

function createDeferredPromise<T>(): {
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

function truncateText(value: string, maxLength = 72): string {
	if (value.length <= maxLength) {
		return value;
	}
	return `${value.slice(0, maxLength).trimEnd()}…`;
}

const overviewFixture: AggregateOverviewResponse = {
	request_id: "req-team-1",
	freshness: {
		status: "fresh",
		checked_at: "2026-03-24T08:00:00Z",
	},
	partial_failure: false,
	diagnostics: [
		{
			instance_id: "instance-alpha",
			instance_name: "alpha-instance",
			status: "ok",
			freshness: {
				status: "fresh",
				checked_at: "2026-03-24T08:00:00Z",
			},
			error: null,
		},
		{
			instance_id: "instance-beta",
			instance_name: "beta-instance",
			status: "ok",
			freshness: {
				status: "fresh",
				checked_at: "2026-03-24T08:00:00Z",
			},
			error: null,
		},
	],
	agents: [
		{
			instance_id: "instance-alpha",
			instance_name: "alpha-instance",
			agent_id: "agent-alpha",
			agent_name: "Alpha Agent",
			status: "running",
			is_active: true,
			last_active_at: "2026-03-24T07:58:00Z",
			drilldown_path: "/session/agent-alpha/channel-alpha/session-alpha-2",
		},
		{
			instance_id: "instance-beta",
			instance_name: "beta-instance",
			agent_id: "agent-beta",
			agent_name: "Beta Agent",
			status: "idle",
			is_active: false,
			last_active_at: "2026-03-23T22:00:00Z",
			drilldown_path: "/session/agent-beta/channel-beta/session-beta-1",
		},
	],
	stats: {
		instance_count: 2,
		agent_count: 2,
		active_agent_count: 1,
		attention_instance_count: 0,
		total_tokens: null,
	},
	token_groups: [],
	global_events: [],
};

function LocationDisplay(): JSX.Element {
	const location = useLocation();
	return (
		<div data-testid="location-display">{`${location.pathname}${location.search}`}</div>
	);
}

function renderPage(): ReturnType<typeof render> {
	return render(
		<MemoryRouter initialEntries={["/team"]}>
			<LocationDisplay />
			<Routes>
				<Route path="/team" element={<TeamPage />} />
				<Route
					path="/session/:agentId/:channelKey/:sessionKey"
					element={<div>session page</div>}
				/>
			</Routes>
		</MemoryRouter>,
	);
}

describe("TeamPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("shows request clues and a partial-failure notice while keeping successful team cards visible", async () => {
		mockGetAggregateOverview.mockResolvedValue(
			buildOverview({
				partial_failure: true,
				diagnostics: [
					overviewFixture.diagnostics[0],
					{
						...overviewFixture.diagnostics[1],
						status: "failed",
						freshness: {
							status: "failed",
							checked_at: "2026-03-24T07:50:00Z",
						},
						error: {
							code: "source_unavailable",
							message: "Beta instance unavailable",
							request_id: "req-team-diag-beta",
							recoverable: true,
							next_step: "检查 beta 实例后重试",
						},
					},
				],
			}),
		);
		mockListSessions.mockImplementation((agentId: string) => {
			if (agentId === "agent-alpha") {
				return Promise.resolve({
					ts: 1711267200,
					count: 1,
					sessions: [
						{
							key: "session-alpha-2",
							kind: "direct",
							label: "Alpha retrospective",
							derived_title: "Alpha retrospective",
							last_message_preview: "Latest Alpha update",
							updated_at: 1711267140,
						},
					],
				});
			}

			return Promise.resolve({
				ts: 1711267200,
				count: 0,
				sessions: [],
			});
		});
		mockPreviewSessions.mockResolvedValue({
			ts: 1711267200,
			previews: [
				{
					key: "session-alpha-2",
					status: "ok",
					items: [{ role: "user", text: alphaOpeningText }],
				},
			],
		});

		renderPage();

		await waitFor(() => {
			expect(screen.getByText("request_id · req-team-1")).toBeInTheDocument();
		});

		expect(screen.getByText("freshness · 数据新鲜")).toBeInTheDocument();
		expect(
			screen.getByText("checked_at · 2026-03-24T08:00:00Z"),
		).toBeInTheDocument();
		expect(
			screen.getByText("diagnostics · 2 overview / 1 failed"),
		).toBeInTheDocument();
		expect(
			screen.getByText("read_chain · overview -> listSessions -> previewSessions"),
		).toBeInTheDocument();
		expect(screen.getByText("部分数据不可用")).toBeInTheDocument();
		expect(
			screen.getByText("受影响实例：beta-instance"),
		).toBeInTheDocument();
		expect(screen.getByTestId("team-agent-card-agent-alpha")).toBeInTheDocument();
		expect(screen.getByTestId("team-agent-card-agent-beta")).toBeInTheDocument();
	});

	it("re-reads the same overview and session chain when refresh is triggered from the successful state", async () => {
		mockGetAggregateOverview
			.mockResolvedValueOnce(buildOverview())
			.mockResolvedValueOnce(
				buildOverview({
					request_id: "req-team-2",
					freshness: {
						status: "stale",
						checked_at: "2026-03-24T08:05:00Z",
					},
				}),
			);
		mockListSessions.mockImplementation((agentId: string) => {
			if (agentId === "agent-alpha") {
				return Promise.resolve({
					ts: 1711267200,
					count: 1,
					sessions: [
						{
							key: "session-alpha-2",
							kind: "direct",
							label: "Alpha retrospective",
							derived_title: "Alpha retrospective",
							last_message_preview: "Latest Alpha update",
							updated_at: 1711267140,
						},
					],
				});
			}

			return Promise.resolve({
				ts: 1711267200,
				count: 1,
				sessions: [
					{
						key: "session-beta-1",
						kind: "group",
						label: "Beta planning",
						derived_title: "Beta planning",
						last_message_preview: "Latest Beta update",
						updated_at: 1711238400,
					},
				],
			});
		});
		mockPreviewSessions.mockImplementation((keys: string[]) => {
			const [sessionKey] = keys;
			return Promise.resolve({
				ts: 1711267200,
				previews: [
					{
						key: sessionKey,
						status: "ok",
						items: [
							{
								role: "user",
								text:
									sessionKey === "session-alpha-2"
										? alphaOpeningText
										: betaOpeningText,
							},
						],
					},
				],
			});
		});

		renderPage();

		await waitFor(() => {
			expect(screen.getByText("request_id · req-team-1")).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole("button", { name: "刷新卡片" }));

		await waitFor(() => {
			expect(screen.getByText("request_id · req-team-2")).toBeInTheDocument();
		});

		expect(mockGetAggregateOverview).toHaveBeenCalledTimes(2);
		expect(mockListSessions).toHaveBeenCalledTimes(4);
		expect(mockPreviewSessions).toHaveBeenCalledTimes(4);
		expect(screen.getByText("当前展示的是滞后团队卡片")).toBeInTheDocument();
	});

	it("shows an explicit unauthorized state instead of a generic failure state", async () => {
		mockGetAggregateOverview.mockRejectedValue(
			new ApiError(401, "Unauthorized", {
				code: "unauthorized",
				message: "Unauthorized",
				request_id: "req-team-401",
				recoverable: true,
				next_step: "重新登录后重试",
			}),
		);

		renderPage();

		await waitFor(() => {
			expect(screen.getByText("当前无权查看团队页")).toBeInTheDocument();
		});

		expect(screen.queryByText("团队页暂时不可用")).not.toBeInTheDocument();
		expect(screen.getByText("request_id · req-team-401")).toBeInTheDocument();
		expect(screen.getByText("重新登录后重试")).toBeInTheDocument();
		expect(
			screen.queryByText("当前没有可展示的 persistent agents"),
		).not.toBeInTheDocument();
	});

	it("shows a readable failed state with request evidence and retries the same truthful read chain", async () => {
		mockGetAggregateOverview
			.mockRejectedValueOnce(
				new ApiError(503, "OpenClaw upstream unavailable", {
					code: "source_unavailable",
					message: "OpenClaw upstream unavailable",
					request_id: "req-team-503",
					recoverable: true,
					next_step: "检查实例连通性后重试",
				}),
			)
			.mockResolvedValueOnce(
				buildOverview({
					request_id: "req-team-recovered",
				}),
			);
		mockListSessions.mockImplementation((agentId: string) => {
			if (agentId === "agent-alpha") {
				return Promise.resolve({
					ts: 1711267200,
					count: 1,
					sessions: [
						{
							key: "session-alpha-2",
							kind: "direct",
							label: "Alpha retrospective",
							derived_title: "Alpha retrospective",
							last_message_preview: "Latest Alpha update",
							updated_at: 1711267140,
						},
					],
				});
			}

			return Promise.resolve({
				ts: 1711267200,
				count: 1,
				sessions: [
					{
						key: "session-beta-1",
						kind: "group",
						label: "Beta planning",
						derived_title: "Beta planning",
						last_message_preview: "Latest Beta update",
						updated_at: 1711238400,
					},
				],
			});
		});
		mockPreviewSessions.mockImplementation((keys: string[]) => {
			const [sessionKey] = keys;
			return Promise.resolve({
				ts: 1711267200,
				previews: [
					{
						key: sessionKey,
						status: "ok",
						items: [
							{
								role: "user",
								text:
									sessionKey === "session-alpha-2"
										? alphaOpeningText
										: betaOpeningText,
							},
						],
					},
				],
			});
		});

		renderPage();

		await waitFor(() => {
			expect(screen.getByText("团队页暂时不可用")).toBeInTheDocument();
		});

		expect(screen.getByText("request_id · req-team-503")).toBeInTheDocument();
		expect(screen.getByText("code · source_unavailable")).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "重试" }));

		await waitFor(() => {
			expect(
				screen.getByText("request_id · req-team-recovered"),
			).toBeInTheDocument();
		});

		expect(mockGetAggregateOverview).toHaveBeenCalledTimes(2);
		expect(mockListSessions).toHaveBeenCalledTimes(2);
		expect(mockPreviewSessions).toHaveBeenCalledTimes(2);
		expect(
			screen.queryByText("当前没有可展示的 persistent agents"),
		).not.toBeInTheDocument();
	});

	it("shows an explicit stale notice while keeping team cards visible", async () => {
		mockGetAggregateOverview.mockResolvedValue(
			buildOverview({
				freshness: {
					status: "stale",
					checked_at: "2026-03-24T07:40:00Z",
				},
			}),
		);
		mockListSessions.mockImplementation((agentId: string) => {
			if (agentId === "agent-alpha") {
				return Promise.resolve({
					ts: 1711267200,
					count: 1,
					sessions: [
						{
							key: "session-alpha-2",
							kind: "direct",
							label: "Alpha retrospective",
							derived_title: "Alpha retrospective",
							last_message_preview: "Latest Alpha update",
							updated_at: 1711267140,
						},
					],
				});
			}

			return Promise.resolve({
				ts: 1711267200,
				count: 1,
				sessions: [
					{
						key: "session-beta-1",
						kind: "group",
						label: "Beta planning",
						derived_title: "Beta planning",
						last_message_preview: "Latest Beta update",
						updated_at: 1711238400,
					},
				],
			});
		});
		mockPreviewSessions.mockImplementation((keys: string[]) => {
			const [sessionKey] = keys;
			return Promise.resolve({
				ts: 1711267200,
				previews: [
					{
						key: sessionKey,
						status: "ok",
						items: [
							{
								role: "user",
								text:
									sessionKey === "session-alpha-2"
										? alphaOpeningText
										: betaOpeningText,
							},
						],
					},
				],
			});
		});

		renderPage();

		await waitFor(() => {
			expect(screen.getByText("当前展示的是滞后团队卡片")).toBeInTheDocument();
		});

		expect(screen.getByTestId("team-agent-card-agent-alpha")).toBeInTheDocument();
		expect(screen.getByText("freshness · 数据滞后")).toBeInTheDocument();
	});

	it("surfaces derived read failures instead of disguising them as empty sessions or generic openings", async () => {
		mockGetAggregateOverview.mockResolvedValue(buildOverview());
		mockListSessions.mockImplementation((agentId: string) => {
			if (agentId === "agent-alpha") {
				return Promise.resolve({
					ts: 1711267200,
					count: 1,
					sessions: [
						{
							key: "session-alpha-2",
							kind: "direct",
							label: "Alpha retrospective",
							derived_title: "Alpha retrospective",
							last_message_preview: "Latest Alpha update",
							updated_at: 1711267140,
						},
					],
				});
			}

			return Promise.reject(
				new ApiError(503, "Beta sessions unavailable", {
					code: "source_unavailable",
					message: "Beta sessions unavailable",
					request_id: "req-team-session-beta",
					recoverable: true,
					next_step: "检查 beta sessions 后重试",
				}),
			);
		});
		mockPreviewSessions.mockRejectedValue(
			new ApiError(503, "Preview unavailable", {
				code: "source_unavailable",
				message: "Preview unavailable",
				request_id: "req-team-preview-alpha",
				recoverable: true,
				next_step: "检查 preview 服务后重试",
			}),
		);

		renderPage();

		await waitFor(() => {
			expect(
				screen.getByText("diagnostics · 2 overview / 0 failed / 2 derived"),
			).toBeInTheDocument();
		});

		expect(screen.getByText("部分数据不可用")).toBeInTheDocument();
		expect(
			screen.getByText(
				"派生读取受影响：Alpha Agent（会话开头）、Beta Agent（会话列表）",
			),
		).toBeInTheDocument();

		const alphaCard = screen.getByTestId("team-agent-card-agent-alpha");
		expect(
			within(alphaCard).getByText("会话开头读取失败，待重试"),
		).toBeInTheDocument();
		expect(
			within(alphaCard).getByText("默认落点：最近活跃会话"),
		).toBeInTheDocument();

		const betaCard = screen.getByTestId("team-agent-card-agent-beta");
		expect(
			within(betaCard).getByText("读取失败，待重试"),
		).toBeInTheDocument();
		expect(
			within(betaCard).getByText("临时落点：默认工作区"),
		).toBeInTheDocument();
		expect(
			within(betaCard).getByText("最近会话读取失败，当前先进入默认工作区复核。"),
		).toBeInTheDocument();
	});

	it("shows an explicit failed state when the overview payload freshness itself is failed", async () => {
		mockGetAggregateOverview.mockResolvedValue(
			buildOverview({
				freshness: {
					status: "failed",
					checked_at: "2026-03-24T07:30:00Z",
				},
				diagnostics: overviewFixture.diagnostics.map((diagnostic) => ({
					...diagnostic,
					status: "failed",
					freshness: {
						status: "failed",
						checked_at: "2026-03-24T07:30:00Z",
					},
					error: {
						code: "source_unavailable",
						message: `${diagnostic.instance_name} unavailable`,
						request_id: "req-team-failed-payload",
						recoverable: true,
						next_step: "检查实例后重试",
					},
				})),
			}),
		);

		renderPage();

		await waitFor(() => {
			expect(screen.getByText("团队页暂时不可用")).toBeInTheDocument();
		});

		expect(screen.getByText("freshness · 数据失败")).toBeInTheDocument();
		expect(
			screen.getByText("当前返回的团队聚合结果已标记为失败，请结合请求线索排查。"),
		).toBeInTheDocument();
		expect(
			screen.queryByText("当前没有可展示的 persistent agents"),
		).not.toBeInTheDocument();
		expect(mockListSessions).not.toHaveBeenCalled();
		expect(mockPreviewSessions).not.toHaveBeenCalled();
	});

	it("keeps the team shell visible while aggregate overview is loading", () => {
		const deferred = createDeferredPromise<AggregateOverviewResponse>();
		mockGetAggregateOverview.mockReturnValue(deferred.promise);

		renderPage();

		expect(screen.getByRole("heading", { name: "团队" })).toBeInTheDocument();
		expect(
			screen.getByRole("heading", { name: "Persistent Agent Cards" }),
		).toBeInTheDocument();
		expect(screen.getByText("正在同步团队常驻席位。")).toBeInTheDocument();
		expect(screen.getByText("加载中")).toBeInTheDocument();
	});

	it("keeps the team stage shell visible with explicit empty language when no team cards can be derived", async () => {
		mockGetAggregateOverview.mockResolvedValue(
			buildOverview({
				diagnostics: [],
				agents: [],
				stats: {
					...overviewFixture.stats,
					instance_count: 0,
					agent_count: 0,
					active_agent_count: 0,
					attention_instance_count: 0,
					total_tokens: null,
				},
			}),
		);

		renderPage();

		await waitFor(() => {
			expect(screen.getByText("当前没有可展示的 persistent agents")).toBeInTheDocument();
		});

		expect(
			screen.getByRole("heading", { name: "Persistent Agent Cards" }),
		).toBeInTheDocument();
		expect(screen.getByText("0 张卡片")).toBeInTheDocument();
		expect(screen.getByText("request_id · req-team-1")).toBeInTheDocument();
	});

	it("renders persistent agent cards with the frozen minimum fields from truthful frontend reads", async () => {
		mockGetAggregateOverview.mockResolvedValue(overviewFixture);
		mockListSessions.mockImplementation((agentId: string) => {
			if (agentId === "agent-alpha") {
				return Promise.resolve({
					ts: 1711267200,
					count: 2,
					sessions: [
						{
							key: "session-alpha-2",
							kind: "direct",
							label: "Alpha retrospective",
							derived_title: "Alpha retrospective",
							last_message_preview: "Latest Alpha update",
							updated_at: 1711267140,
						},
						{
							key: "session-alpha-1",
							kind: "group",
							label: "Alpha kickoff",
							derived_title: "Alpha kickoff",
							last_message_preview: "Older Alpha update",
							updated_at: 1711263540,
						},
					],
				});
			}

			return Promise.resolve({
				ts: 1711267200,
				count: 1,
				sessions: [
					{
						key: "session-beta-1",
						kind: "group",
						label: "Beta planning",
						derived_title: "Beta planning",
						last_message_preview: "Latest Beta update",
						updated_at: 1711238400,
					},
				],
			});
		});
		mockPreviewSessions.mockImplementation((keys: string[]) => {
			const [sessionKey] = keys;
			if (sessionKey === "session-alpha-2") {
				return Promise.resolve({
					ts: 1711267200,
					previews: [
						{
							key: "session-alpha-2",
							status: "ok",
							items: [
								{
									role: "user",
									text: alphaOpeningText,
								},
							],
						},
					],
				});
			}

			return Promise.resolve({
				ts: 1711267200,
				previews: [
					{
						key: "session-beta-1",
						status: "ok",
						items: [
							{
								role: "assistant",
								text: betaOpeningText,
							},
						],
					},
				],
			});
		});

		renderPage();

		await waitFor(() => {
			expect(screen.getByTestId("team-agent-cards-stage")).toBeInTheDocument();
		});

		expect(mockGetAggregateOverview).toHaveBeenCalledTimes(1);
		expect(mockListSessions).toHaveBeenNthCalledWith(1, "agent-alpha", {
			instanceId: "instance-alpha",
		});
		expect(mockListSessions).toHaveBeenNthCalledWith(2, "agent-beta", {
			instanceId: "instance-beta",
		});
		expect(mockPreviewSessions).toHaveBeenNthCalledWith(
			1,
			["session-alpha-2"],
			{
				instanceId: "instance-alpha",
			},
		);
		expect(mockPreviewSessions).toHaveBeenNthCalledWith(2, ["session-beta-1"], {
			instanceId: "instance-beta",
		});

		const alphaCard = screen.getByTestId("team-agent-card-agent-alpha");
		expect(
			within(alphaCard).getByRole("img", { name: "Alpha Agent 头像" }),
		).toBeInTheDocument();
		expect(within(alphaCard).getByText("Alpha Agent")).toBeInTheDocument();
		expect(within(alphaCard).getByText("alpha-instance")).toBeInTheDocument();
		expect(within(alphaCard).getByText("运行中")).toBeInTheDocument();
		expect(within(alphaCard).getByText("最后会话")).toBeInTheDocument();
		expect(within(alphaCard).getByText("2024-03-24 07:59")).toBeInTheDocument();
		expect(within(alphaCard).getByText("会话开头")).toBeInTheDocument();
		expect(
			within(alphaCard).getByText(truncateText(alphaOpeningText)),
		).toBeInTheDocument();
		expect(
			within(alphaCard).queryByText(alphaOpeningText),
		).not.toBeInTheDocument();

		const betaCard = screen.getByTestId("team-agent-card-agent-beta");
		expect(
			within(betaCard).getByRole("img", { name: "Beta Agent 头像" }),
		).toBeInTheDocument();
		expect(within(betaCard).getByText("Beta Agent")).toBeInTheDocument();
		expect(within(betaCard).getByText("beta-instance")).toBeInTheDocument();
		expect(within(betaCard).getByText("空闲")).toBeInTheDocument();
		expect(within(betaCard).getByText("2024-03-24 00:00")).toBeInTheDocument();
		expect(
			within(betaCard).getByText(truncateText(betaOpeningText)),
		).toBeInTheDocument();

		expect(
			screen.queryByText("详细字段将在现有壳层内继续补齐。"),
		).not.toBeInTheDocument();
	});

	it("keeps the minimum fields visible with truthful empty-session fallbacks when an agent has no sessions", async () => {
		mockGetAggregateOverview.mockResolvedValue({
			...overviewFixture,
			agents: [overviewFixture.agents[0]],
			diagnostics: [overviewFixture.diagnostics[0]],
		});
		mockListSessions.mockResolvedValue({
			ts: 1711267200,
			count: 0,
			sessions: [],
		});
		mockPreviewSessions.mockResolvedValue({
			ts: 1711267200,
			previews: [],
		});

		renderPage();

		await waitFor(() => {
			expect(
				screen.getByTestId("team-agent-card-agent-alpha"),
			).toBeInTheDocument();
		});

		const card = screen.getByTestId("team-agent-card-agent-alpha");
		expect(
			within(card).getByRole("img", { name: "Alpha Agent 头像" }),
		).toBeInTheDocument();
		expect(within(card).getByText("最后会话")).toBeInTheDocument();
		expect(within(card).getByText("暂无会话")).toBeInTheDocument();
		expect(within(card).getByText("会话开头")).toBeInTheDocument();
		expect(within(card).getByText("暂无会话开头")).toBeInTheDocument();
		expect(
			within(card).getByText("默认落点：当前默认工作区"),
		).toBeInTheDocument();
		expect(
			within(card).getByText("暂无历史会话，将先进入当前默认工作区。"),
		).toBeInTheDocument();
		expect(
			within(card).getByRole("link", {
				name: "进入默认工作区",
			}),
		).toHaveAttribute(
			"href",
			buildSessionEntryPath({
				instanceId: "instance-alpha",
				agentId: "agent-alpha",
			}),
		);
		expect(mockPreviewSessions).not.toHaveBeenCalled();
	});

	it("uses the latest session as the default landing when the card or primary CTA is activated", async () => {
		const user = userEvent.setup();

		mockGetAggregateOverview.mockResolvedValue({
			...overviewFixture,
			agents: [overviewFixture.agents[0]],
			diagnostics: [overviewFixture.diagnostics[0]],
		});
		mockListSessions.mockResolvedValue({
			ts: 1711267200,
			count: 2,
			sessions: [
				{
					key: "session-alpha-2",
					kind: "direct",
					label: "Alpha retrospective",
					derived_title: "Alpha retrospective",
					last_message_preview: "Latest Alpha update",
					updated_at: 1711267140,
				},
				{
					key: "session-alpha-1",
					kind: "group",
					label: "Alpha kickoff",
					derived_title: "Alpha kickoff",
					last_message_preview: "Older Alpha update",
					updated_at: 1711263540,
				},
			],
		});
		mockPreviewSessions.mockResolvedValue({
			ts: 1711267200,
			previews: [
				{
					key: "session-alpha-2",
					status: "ok",
					items: [{ role: "user", text: alphaOpeningText }],
				},
			],
		});

		renderPage();

		await waitFor(() => {
			expect(
				screen.getByTestId("team-agent-card-agent-alpha"),
			).toBeInTheDocument();
		});

		const card = screen.getByTestId("team-agent-card-agent-alpha");
		const expectedPath = buildSessionEntryPath({
			instanceId: "instance-alpha",
			agentId: "agent-alpha",
			preferredSessionKey: "session-alpha-2",
		});

		expect(
			within(card).getByText("默认落点：最近活跃会话"),
		).toBeInTheDocument();
		expect(
			within(card).getByText("将优先进入该 agent 最近活跃的会话。"),
		).toBeInTheDocument();

		const entryLink = within(card).getByRole("link", {
			name: "进入最近活跃会话",
		});
		expect(entryLink).toHaveAttribute("href", expectedPath);

		await user.click(card);

		await waitFor(() => {
			expect(screen.getByTestId("location-display")).toHaveTextContent(
				expectedPath,
			);
		});
	});

	it("disables session entry when the basic agent context is missing", async () => {
		mockGetAggregateOverview.mockResolvedValue({
			...overviewFixture,
			agents: [
				{
					...overviewFixture.agents[0],
					instance_id: "",
					instance_name: "missing-instance",
				},
			],
			diagnostics: [overviewFixture.diagnostics[0]],
		});
		mockListSessions.mockResolvedValue({
			ts: 1711267200,
			count: 0,
			sessions: [],
		});

		renderPage();

		await waitFor(() => {
			expect(
				screen.getByTestId("team-agent-card-agent-alpha"),
			).toBeInTheDocument();
		});

		const card = screen.getByTestId("team-agent-card-agent-alpha");
		expect(
			within(card).getByText("入口不可用：缺少基础上下文"),
		).toBeInTheDocument();
		expect(
			within(card).getByText(
				"缺少实例或 agent 标识，当前不能安全进入 session 工作区。",
			),
		).toBeInTheDocument();
		expect(
			within(card).getByRole("button", {
				name: "当前不可进入 session 工作区",
			}),
		).toBeDisabled();
		expect(within(card).queryByRole("link")).not.toBeInTheDocument();
		expect(mockListSessions).not.toHaveBeenCalled();
		expect(mockPreviewSessions).not.toHaveBeenCalled();
	});
});
