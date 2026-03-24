import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
	ApiError,
	getAgentDetail,
	getDefaultObserverDataSource,
	listSessions,
	previewSessions,
} from "../api/client";
import {
	createObserverRealtimeClient,
	type ObserverRealtimeClient,
	type ObserverRealtimeClientOptions,
} from "../api/realtimeClient";
import {
	type AgentDetailResponse,
	buildAgentDetailChannel,
	buildSessionMessagesChannel,
	type ErrorEnvelope,
	type SessionListItem,
	type SessionPreviewItem,
	type SessionsPreviewResponse,
	type TopologyNode,
} from "../api/types";
import { useIsMobile } from "../hooks/useIsMobile";

interface AgentWorkspaceProps {
	agentId?: string;
	instanceId?: string;
	preferredSessionKey?: string | null;
}

interface RealtimeState {
	status: "realtime" | "reconnecting" | "resyncing" | "disconnected" | "error";
	message: string | null;
}

type AgentDetailUpdate =
	| AgentDetailResponse
	| null
	| ((previous: AgentDetailResponse | null) => AgentDetailResponse | null);

interface StartAgentDetailRealtimeOptions {
	agentId: string;
	getAgentDetailFn: (agentId: string) => Promise<AgentDetailResponse>;
	createRealtimeClientFn: (
		options: ObserverRealtimeClientOptions,
	) => ObserverRealtimeClient;
	applyAgent: (update: AgentDetailUpdate) => void;
	setRealtimeState?: (state: RealtimeState) => void;
}

const AGENT_DETAIL_REALTIME_DATA_SOURCE = getDefaultObserverDataSource();
const SESSION_STALE_THRESHOLD_MS = 5 * 60 * 1000;
const SESSION_READ_CHAIN_CLUE =
	"getAgentDetail -> listSessions -> previewSessions (+ realtime after selection)";

function withErrorMessage(error: unknown, fallback: string): string {
	return error instanceof Error ? error.message : fallback;
}

function ensureError(error: unknown, fallback: string): Error {
	return error instanceof Error ? error : new Error(fallback);
}

function getErrorEnvelope(error: Error | null): ErrorEnvelope | null {
	return error instanceof ApiError ? error.envelope : null;
}

function describeReadStep(args: {
	step: "getAgentDetail" | "listSessions" | "previewSessions";
	error: Error | null;
	loaded?: boolean;
	count?: number;
	emptyLabel?: string;
	skipped?: boolean;
}): string {
	if (args.skipped) return `${args.step} skipped`;
	const envelope = getErrorEnvelope(args.error);
	if (envelope?.code === "unauthorized") {
		return `${args.step} unauthorized`;
	}
	if (args.error) return `${args.step} failed`;
	if (typeof args.count === "number") {
		if (args.count === 0 && args.emptyLabel) {
			return `${args.step} ${args.emptyLabel}(0)`;
		}
		return `${args.step} ok(${args.count})`;
	}
	if (args.loaded) return `${args.step} ok`;
	return `${args.step} loading`;
}

function getRequestIdClue(errors: Array<Error | null>): string {
	for (const error of errors) {
		const requestId = getErrorEnvelope(error)?.request_id;
		if (requestId) return requestId;
	}
	return "当前真实读链路未返回 aggregate request_id";
}

function getFreshnessClue(
	sessionListTs: number | null,
	previewTs: number | null,
): { label: string; stale: boolean } {
	const ts = previewTs ?? sessionListTs;
	if (ts === null) {
		return {
			label: "当前 endpoints 未返回 freshness；仅在 list/preview ts 可用时做推断",
			stale: false,
		};
	}

	const source = previewTs !== null ? "previewSessions.ts" : "listSessions.ts";
	const stale = Date.now() - ts > SESSION_STALE_THRESHOLD_MS;
	return {
		label: `${stale ? "inferred stale" : "inferred fresh"} from ${source}`,
		stale,
	};
}

function findRootNode(
	nodes: TopologyNode[],
	rootNodeId: string,
): TopologyNode | null {
	return (
		nodes.find((node) => node.id === rootNodeId) ??
		nodes.find((node) => node.parent_id === null) ??
		nodes[0] ??
		null
	);
}

function mergeAgentDetailTopology(
	previous: AgentDetailResponse,
	nextNodes: TopologyNode[],
): AgentDetailResponse {
	const nextRoot = findRootNode(nextNodes, previous.root_node_id);
	const nextRootNodeId = nextRoot?.id ?? previous.root_node_id;
	return {
		...previous,
		status: nextRoot?.status ?? previous.status,
		is_active: nextRoot?.is_active ?? previous.is_active,
		root_node_id: nextRootNodeId,
		root_child_count: nextNodes.filter(
			(node) => node.parent_id === nextRootNodeId,
		).length,
		total_node_count: nextNodes.length,
		nodes: nextNodes,
	};
}

export function resolveSelectedSessionKey(
	sessions: ReadonlyArray<Pick<SessionListItem, "key">>,
	currentKey: string | null,
	preferredKey: string | null = null,
): string | null {
	const explicitPreferredSessionKey =
		preferredKey && sessions.some((session) => session.key === preferredKey)
			? preferredKey
			: null;
	if (explicitPreferredSessionKey) return explicitPreferredSessionKey;

	const currentValidSessionKey =
		currentKey && sessions.some((session) => session.key === currentKey)
			? currentKey
			: null;
	if (currentValidSessionKey) return currentValidSessionKey;

	return sessions[0]?.key ?? null;
}

export function getFallbackSessionKeyAfterDelete(
	sessions: ReadonlyArray<Pick<SessionListItem, "key">>,
	deletedKey: string,
): string | null {
	const deletedIndex = sessions.findIndex(
		(session) => session.key === deletedKey,
	);
	if (deletedIndex === -1) {
		return sessions[0]?.key ?? null;
	}

	return (
		sessions[deletedIndex + 1]?.key ?? sessions[deletedIndex - 1]?.key ?? null
	);
}

export function getSessionModel(
	sessionModels: Record<string, string>,
	sessionKey: string,
	defaultModel: string | null,
): string | null {
	return sessionModels[sessionKey] ?? defaultModel ?? null;
}

export function updateSessionModel(
	sessionModels: Record<string, string>,
	sessionKey: string,
	modelId: string,
): Record<string, string> {
	return { ...sessionModels, [sessionKey]: modelId };
}

export function shouldShowModelUpdateStatus(
	status: "idle" | "updating" | "success" | "failed",
	updateSessionKey: string | null,
	currentSessionKey: string | null,
): boolean {
	return status !== "idle" && updateSessionKey === currentSessionKey;
}

export function getPreviewItemsForSession(
	response: SessionsPreviewResponse,
	sessionKey: string,
): SessionPreviewItem[] {
	const preview = response.previews.find((item) => item.key === sessionKey);
	return preview?.status === "ok" ? preview.items : [];
}

export function mergeStreamingAssistantText(
	previousText: string,
	incomingText: string,
): string {
	if (!incomingText) return previousText;
	if (!previousText) return incomingText;
	if (incomingText.startsWith(previousText)) return incomingText;
	if (previousText.startsWith(incomingText)) return previousText;
	if (previousText.endsWith(incomingText)) return previousText;
	return `${previousText}${incomingText}`;
}

export function mergePreviewItemsFromRealtime(
	previousItems: SessionPreviewItem[],
	incomingItems: SessionPreviewItem[],
): SessionPreviewItem[] {
	if (incomingItems.length === 0) return previousItems;

	if (!(incomingItems.length === 1 && incomingItems[0].role === "assistant")) {
		return incomingItems;
	}

	if (previousItems.length === 0) return incomingItems;

	const lastIndex = previousItems.length - 1;
	const lastItem = previousItems[lastIndex];
	const [incomingAssistantMessage] = incomingItems;

	if (lastItem.role !== "assistant") {
		return [...previousItems, incomingAssistantMessage];
	}

	const mergedText = mergeStreamingAssistantText(
		lastItem.text,
		incomingAssistantMessage.text,
	);
	if (mergedText === lastItem.text) return previousItems;

	return [
		...previousItems.slice(0, lastIndex),
		{ ...lastItem, text: mergedText },
	];
}

export function arePreviewItemsEqual(
	previousItems: SessionPreviewItem[],
	nextItems: SessionPreviewItem[],
): boolean {
	if (previousItems === nextItems) return true;
	if (previousItems.length !== nextItems.length) return false;

	for (let index = 0; index < previousItems.length; index += 1) {
		const previous = previousItems[index];
		const next = nextItems[index];
		if (previous.role !== next.role || previous.text !== next.text) {
			return false;
		}
	}

	return true;
}

export async function startAgentDetailRealtime(
	options: StartAgentDetailRealtimeOptions,
): Promise<{ close: () => void } | null> {
	let latestAgent: AgentDetailResponse | null = null;
	const applySnapshot = (snapshot: AgentDetailResponse): void => {
		latestAgent = snapshot;
		options.applyAgent(snapshot);
	};

	const snapshot = await options.getAgentDetailFn(options.agentId);
	applySnapshot(snapshot);
	options.setRealtimeState?.({ status: "reconnecting", message: null });

	const runResync = async (): Promise<void> => {
		options.setRealtimeState?.({ status: "resyncing", message: null });
		try {
			const refreshed = await options.getAgentDetailFn(options.agentId);
			applySnapshot(refreshed);
			options.setRealtimeState?.({ status: "realtime", message: null });
		} catch (error) {
			options.setRealtimeState?.({
				status: "error",
				message: withErrorMessage(error, "同步代理详情失败"),
			});
		}
	};

	try {
		const realtimeClient = options.createRealtimeClientFn({
			dataSource: AGENT_DETAIL_REALTIME_DATA_SOURCE,
			channel: buildAgentDetailChannel(options.agentId),
			onMessage: (message) => {
				if (message.type === "snapshot_ready") {
					options.setRealtimeState?.({ status: "realtime", message: null });
					return;
				}
				if (
					message.type === "topology_updated" &&
					message.payload.agent_id === options.agentId
				) {
					if (!latestAgent) return;
					const nextAgent = mergeAgentDetailTopology(
						latestAgent,
						message.payload.nodes,
					);
					latestAgent = nextAgent;
					options.applyAgent(nextAgent);
					options.setRealtimeState?.({ status: "realtime", message: null });
					return;
				}
				if (message.type === "error") {
					options.setRealtimeState?.({
						status: "error",
						message: message.payload.detail,
					});
					return;
				}
			},
			onResyncRequired: () => {
				void runResync();
			},
			onParseError: (_raw, error) => {
				options.setRealtimeState?.({
					status: "error",
					message: withErrorMessage(error, "解析实时消息失败"),
				});
			},
			onDisconnected: () => {
				options.setRealtimeState?.({
					status: "disconnected",
					message: "实时连接意外断开",
				});
			},
		});
		realtimeClient.connect();
		return realtimeClient;
	} catch (error) {
		options.setRealtimeState?.({
			status: "error",
			message: withErrorMessage(error, "连接实时通道失败"),
		});
		return null;
	}
}

export function AgentWorkspace(props: AgentWorkspaceProps): JSX.Element {
	const { agentId: paramAgentId, instanceId: paramInstanceId } = useParams<{
		agentId: string;
		instanceId?: string;
	}>();
	const agentId = props.agentId ?? paramAgentId;
	const instanceId = props.instanceId ?? paramInstanceId ?? null;
	const isMobile = useIsMobile();
	const [agent, setAgent] = useState<AgentDetailResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [agentError, setAgentError] = useState<Error | null>(null);
	const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(null);
	const [previewItems, setPreviewItems] = useState<SessionPreviewItem[]>([]);
	const [previewLoading, setPreviewLoading] = useState(false);
	const [previewError, setPreviewError] = useState<Error | null>(null);
	const [previewTs, setPreviewTs] = useState<number | null>(null);
	const [sessions, setSessions] = useState<SessionListItem[]>([]);
	const [sessionsError, setSessionsError] = useState<Error | null>(null);
	const [sessionListLoaded, setSessionListLoaded] = useState(false);
	const [sessionListTs, setSessionListTs] = useState<number | null>(null);
	const [showDisclosure, setShowDisclosure] = useState(false);

	const messagesAreaRef = useRef<HTMLDivElement | null>(null);
	const sessionRealtimeRef = useRef<ObserverRealtimeClient | null>(null);
	const prevSessionKeyRef = useRef<string | null>(null);

	useEffect(() => {
		if (!agentId) {
			setSelectedSessionKey(null);
			setPreviewItems([]);
			setPreviewLoading(false);
			setPreviewError(null);
			setPreviewTs(null);
			setSessions([]);
			setSessionsError(null);
			setSessionListLoaded(false);
			setSessionListTs(null);
			prevSessionKeyRef.current = null;
			return;
		}
		setSelectedSessionKey(null);
		setPreviewItems([]);
		setPreviewLoading(false);
		setPreviewError(null);
		setPreviewTs(null);
		setSessions([]);
		setSessionsError(null);
		setSessionListLoaded(false);
		setSessionListTs(null);
		prevSessionKeyRef.current = null;
	}, [agentId]);

	useEffect(() => {
		if (!agentId) return;
		let cancelled = false;
		async function fetchSessionState(): Promise<void> {
			setSessionsError(null);
			setSessionListLoaded(false);
			setSessionListTs(null);
			try {
				const response = await listSessions(agentId, {
					instanceId,
				});
				const nextSessions = response.sessions;
				if (!cancelled) {
					setSessionsError(null);
					setSessionListLoaded(true);
					setSessionListTs(response.ts);
					setSessions(nextSessions);
					setSelectedSessionKey((currentKey) =>
						resolveSelectedSessionKey(
							nextSessions,
							currentKey,
							props.preferredSessionKey ?? null,
						),
					);
					if (nextSessions.length === 0) {
						setPreviewItems([]);
						setPreviewLoading(false);
						setPreviewError(null);
						setPreviewTs(null);
						prevSessionKeyRef.current = null;
					}
				}
			} catch (error) {
				if (!cancelled) {
					setSessionsError(ensureError(error, "读取会话列表失败"));
					setSessionListLoaded(true);
					setSessionListTs(null);
					setSessions([]);
					setSelectedSessionKey(null);
					setPreviewItems([]);
					setPreviewLoading(false);
					setPreviewError(null);
					setPreviewTs(null);
					prevSessionKeyRef.current = null;
				}
			}
		}
		void fetchSessionState();
		return () => {
			cancelled = true;
		};
	}, [agentId, instanceId, props.preferredSessionKey]);

	const scrollToBottom = useCallback(() => {
		setTimeout(() => {
			if (messagesAreaRef.current) {
				messagesAreaRef.current.scrollTop =
					messagesAreaRef.current.scrollHeight;
			}
		}, 0);
	}, []);

	useEffect(() => {
		if (!selectedSessionKey) return;
		const sessionKey = selectedSessionKey;

		if (prevSessionKeyRef.current === sessionKey) return;
		prevSessionKeyRef.current = sessionKey;

		let cancelled = false;

		async function fetchPreview(): Promise<void> {
			setPreviewLoading(true);
			setPreviewError(null);
			try {
				const response = await previewSessions([sessionKey], { instanceId });
				if (!cancelled) {
					setPreviewTs(response.ts);
					setPreviewError(null);
					const nextItems = getPreviewItemsForSession(response, sessionKey);
					setPreviewItems((previousItems) =>
						arePreviewItemsEqual(previousItems, nextItems)
							? previousItems
							: nextItems,
					);
					if (nextItems.length > 0) {
						scrollToBottom();
					}
				}
			} catch (error) {
				if (!cancelled) {
					setPreviewError(ensureError(error, "读取会话预览失败"));
					setPreviewTs(null);
					setPreviewItems((previousItems) =>
						previousItems.length === 0 ? previousItems : [],
					);
				}
			} finally {
				if (!cancelled) setPreviewLoading(false);
			}
		}
		void fetchPreview();
		return () => {
			cancelled = true;
		};
	}, [instanceId, selectedSessionKey, scrollToBottom]);

	const refreshPreview = useCallback(
		async (sessionKey: string | null = selectedSessionKey): Promise<void> => {
			if (!sessionKey) {
				setPreviewItems([]);
				setPreviewLoading(false);
				setPreviewError(null);
				setPreviewTs(null);
				return;
			}
			setPreviewLoading(true);
			setPreviewError(null);
			try {
				const response = await previewSessions([sessionKey], { instanceId });
				setPreviewTs(response.ts);
				setPreviewError(null);
				const nextItems = getPreviewItemsForSession(response, sessionKey);
				setPreviewItems((previousItems) =>
					arePreviewItemsEqual(previousItems, nextItems)
						? previousItems
						: nextItems,
				);
				if (nextItems.length > 0) {
					scrollToBottom();
				}
			} catch (error) {
				setPreviewError(ensureError(error, "读取会话预览失败"));
				setPreviewTs(null);
				setPreviewItems((previousItems) =>
					previousItems.length === 0 ? previousItems : [],
				);
			} finally {
				setPreviewLoading(false);
			}
		},
		[instanceId, selectedSessionKey, scrollToBottom],
	);

	useEffect(() => {
		if (!selectedSessionKey) {
			sessionRealtimeRef.current?.close();
			sessionRealtimeRef.current = null;
			return;
		}

		const sessionKey = selectedSessionKey;
		let cancelled = false;

		const startSessionRealtime = (): void => {
			const client = createObserverRealtimeClient({
				dataSource: AGENT_DETAIL_REALTIME_DATA_SOURCE,
				instanceId,
				channel: buildSessionMessagesChannel(sessionKey),
				onMessage: (message) => {
					if (cancelled) return;
					if (
						message.type === "session_messages_updated" &&
						message.payload.session_key === sessionKey
					) {
						const shouldMergeRealtimeChunk =
							message.payload.update_mode === "append_chunk" ||
							(message.payload.update_mode === undefined &&
								message.payload.messages.length === 1 &&
								message.payload.messages[0]?.role === "assistant");

						if (shouldMergeRealtimeChunk) {
							setPreviewItems((previousItems) =>
								mergePreviewItemsFromRealtime(
									previousItems,
									message.payload.messages,
								),
							);
						} else {
							setPreviewItems((previousItems) =>
								arePreviewItemsEqual(previousItems, message.payload.messages)
									? previousItems
									: message.payload.messages,
							);
						}
						scrollToBottom();
					}
				},
				onResyncRequired: () => {
					if (cancelled) return;
					void refreshPreview(sessionKey);
				},
			});
			client.connect();
			sessionRealtimeRef.current = client;
		};

		startSessionRealtime();

		return () => {
			cancelled = true;
			sessionRealtimeRef.current?.close();
			sessionRealtimeRef.current = null;
		};
	}, [instanceId, selectedSessionKey, refreshPreview, scrollToBottom]);

	useEffect(() => {
		if (!agentId) {
			setAgentError(new Error("未提供实例 ID"));
			setLoading(false);
			return;
		}
		setLoading(true);
		setAgentError(null);
		setAgent(null);

		let cancelled = false;
		let realtimeHandle: { close: () => void } | null = null;

		async function loadSnapshotAndSubscribe(id: string) {
			try {
				const handle = await startAgentDetailRealtime({
					agentId: id,
					getAgentDetailFn: (currentAgentId) =>
						getAgentDetail(currentAgentId, { instanceId }),
					createRealtimeClientFn: (options) =>
						createObserverRealtimeClient({ ...options, instanceId }),
					applyAgent: (update) => {
						if (cancelled) return;
						setAgent((previousAgent) =>
							typeof update === "function" ? update(previousAgent) : update,
						);
					},
				});
				if (!cancelled) {
					realtimeHandle = handle;
				} else {
					handle?.close();
				}
			} catch (err) {
				if (!cancelled) {
					setAgentError(ensureError(err, "获取实例失败"));
				}
			} finally {
				if (!cancelled) setLoading(false);
			}
		}

		void loadSnapshotAndSubscribe(agentId);
		return () => {
			cancelled = true;
			realtimeHandle?.close();
		};
	}, [agentId, instanceId]);

	if (loading) {
		return (
			<div style={getContainerStyle(isMobile)} data-testid="session-stream-shell">
				<div style={loadingContainerStyle}>
					<span style={loadingTextStyle}>加载中...</span>
				</div>
			</div>
		);
	}

	const agentEnvelope = getErrorEnvelope(agentError);
	const sessionsEnvelope = getErrorEnvelope(sessionsError);
	const previewEnvelope = getErrorEnvelope(previewError);
	const unauthorizedEnvelope =
		agentEnvelope?.code === "unauthorized"
			? agentEnvelope
			: sessionsEnvelope?.code === "unauthorized"
				? sessionsEnvelope
				: previewEnvelope?.code === "unauthorized"
					? previewEnvelope
					: null;
	const freshness = getFreshnessClue(sessionListTs, previewTs);
	const diagnosticsClue = [
		describeReadStep({
			step: "getAgentDetail",
			error: agentError,
			loaded: Boolean(agent),
		}),
		describeReadStep({
			step: "listSessions",
			error: sessionsError,
			loaded: sessionListLoaded,
			count: sessionListLoaded && !sessionsError ? sessions.length : undefined,
			emptyLabel: "empty",
		}),
		describeReadStep({
			step: "previewSessions",
			error: previewError,
			loaded: previewTs !== null,
			count:
				selectedSessionKey && previewTs !== null && !previewError
					? previewItems.length
					: undefined,
			skipped: !selectedSessionKey,
		}),
	].join(" · ");
	const requestIdClue = getRequestIdClue([
		agentError,
		sessionsError,
		previewError,
	]);
	const showPartialFailure =
		!unauthorizedEnvelope && Boolean(agent) && Boolean(sessionsError || previewError);
	const shellTitle = agent?.id ?? agentId ?? "unknown-agent";
	const shellStatus = unauthorizedEnvelope
		? "○ 读取受限"
		: agent?.is_active
			? "● 运行中"
			: "○ 已停止";
	const emptySessionText = selectedSessionKey ? "暂无消息" : "当前工作区暂无可用会话";

	if (agentError && !unauthorizedEnvelope) {
		return (
			<div style={getContainerStyle(isMobile)} data-testid="session-stream-shell">
				<div style={loadingContainerStyle}>
					<div style={statusCardStyle}>
						<strong style={statusCardTitleStyle}>会话工作区暂时不可用</strong>
						<p style={statusCardDetailStyle}>
							getAgentDetail 失败：{agentError.message}
						</p>
						<p style={requestClueTextStyle}>诊断状态 · failed</p>
					</div>
				</div>
			</div>
		);
	}

	if (!agent && !unauthorizedEnvelope) {
		return (
			<div style={getContainerStyle(isMobile)} data-testid="session-stream-shell">
				<div style={loadingContainerStyle}>
					<span style={loadingTextStyle}>未找到实例</span>
				</div>
			</div>
		);
	}

	return (
		<div style={getContainerStyle(isMobile)} data-testid="session-stream-shell">
			<div data-testid="agent-header" style={agentHeaderStyle}>
				<span style={agentHeaderTitleStyle}>{shellTitle}</span>
				<span style={agentHeaderStatusStyle}>{shellStatus}</span>
			</div>

			<div style={getWorkspaceLayoutStyle(isMobile)}>
				<div data-testid="session-left-sidebar" style={getLeftSidebarStyle(isMobile)}>
					<div data-testid="session-channel-area" style={channelAreaStyle}>
						<span style={sectionLabelStyle}>渠道</span>
						<span style={placeholderTextStyle}>当前阶段暂无渠道数据</span>
					</div>

					<div data-testid="session-list-area" style={sessionListAreaStyle}>
						<span style={sectionLabelStyle}>会话</span>
						{sessionsError ? (
							<span style={sidebarErrorTextStyle}>
								会话列表读取失败：{sessionsError.message}
							</span>
						) : sessions.length === 0 ? (
							<span style={placeholderTextStyle}>暂无会话</span>
						) : (
							<div style={sessionListStyle}>
								{sessions.map((session) => (
									<button
										key={session.key}
										type="button"
										onClick={() => {
											setSelectedSessionKey(session.key);
											setPreviewItems([]);
											setPreviewLoading(true);
										}}
										style={getSessionItemStyle(session.key === selectedSessionKey)}
									>
										{session.derived_title || session.label || session.key}
									</button>
								))}
							</div>
						)}
					</div>
				</div>

				<div style={getMainContentStyle(isMobile)}>
					<div style={requestCluesWrapStyle}>
						<span style={sectionLabelStyle}>请求线索</span>
						<div style={requestCluesBoxStyle}>
							<p style={requestClueTextStyle}>request_id · {requestIdClue}</p>
							<p style={requestClueTextStyle}>freshness · {freshness.label}</p>
							<p style={requestClueTextStyle}>diagnostics · {diagnosticsClue}</p>
							<p style={requestClueTextStyle}>read chain · {SESSION_READ_CHAIN_CLUE}</p>
							{unauthorizedEnvelope ? (
								<p style={requestClueTextStyle}>
									diagnostic_reason · {unauthorizedEnvelope.message}
								</p>
							) : null}
						</div>
					</div>

					{showPartialFailure ? (
						<div style={warningNoticeStyle}>
							<strong style={statusCardTitleStyle}>会话下游读取失败</strong>
							<p style={statusCardDetailStyle}>
								{sessionsError
									? `会话列表读取失败：${sessionsError.message}`
									: `previewSessions 失败：${previewError?.message ?? "unknown error"}`}
							</p>
						</div>
					) : null}

					{unauthorizedEnvelope ? (
						<div style={warningNoticeStyle}>
							<strong style={statusCardTitleStyle}>当前无权查看该会话工作区</strong>
							<p style={statusCardDetailStyle}>{unauthorizedEnvelope.message}</p>
							{unauthorizedEnvelope.next_step ? (
								<p style={statusCardDetailStyle}>{unauthorizedEnvelope.next_step}</p>
							) : null}
						</div>
					) : null}

					{!showPartialFailure && !unauthorizedEnvelope && freshness.stale ? (
						<div style={infoNoticeStyle}>
							<strong style={statusCardTitleStyle}>当前展示的是推断滞后数据</strong>
							<p style={statusCardDetailStyle}>
								当前 session 没有 aggregate freshness；此处仅根据最近一次 list/preview ts 推断。
							</p>
						</div>
					) : null}

					<div data-testid="session-conversation-area" style={getMessagesContainerStyle(isMobile)}>
						<div ref={messagesAreaRef} style={messagesAreaStyle}>
							{unauthorizedEnvelope ? (
								<div style={messagesEmptyStyle}>
									<span style={messagesEmptyTextStyle}>当前无权读取会话内容</span>
								</div>
							) : previewLoading ? (
								<div style={messagesEmptyStyle}>
									<span style={messagesEmptyTextStyle}>加载消息...</span>
								</div>
							) : sessionsError ? (
								<div style={statusCardStyle}>
									<strong style={statusCardTitleStyle}>当前会话列表不可用</strong>
									<p style={statusCardDetailStyle}>
										会话列表读取失败：{sessionsError.message}
									</p>
								</div>
							) : previewError ? (
								<div style={statusCardStyle}>
									<strong style={statusCardTitleStyle}>当前会话预览不可用</strong>
									<p style={statusCardDetailStyle}>
										previewSessions 失败：{previewError.message}
									</p>
								</div>
							) : previewItems.length === 0 ? (
								<div style={messagesEmptyStyle}>
									<span style={messagesEmptyTextStyle}>{emptySessionText}</span>
								</div>
							) : (
								<div style={previewListStyle}>
									{previewItems.map((item, index) => (
										<div
											key={`msg-${index}-${item.role}`}
											style={getPreviewItemStyle(item.role)}
										>
											<span style={previewRoleStyle}>
												{getRoleLabel(item.role)}
											</span>
											<p style={previewTextStyle}>{item.text}</p>
										</div>
									))}
								</div>
							)}
						</div>
					</div>

					<div
						data-testid="session-input-shell"
						style={getInputShellStyle(isMobile)}
						aria-disabled={unauthorizedEnvelope ? true : undefined}
					>
						{unauthorizedEnvelope ? (
							<div style={disclosureContentStyle}>
								<span style={disclosureTitleStyle}>只读观察模式</span>
								<span style={disclosureTextStyle}>
									输入区保持只读：{unauthorizedEnvelope.message}
								</span>
							</div>
						) : !showDisclosure ? (
							<button
								type="button"
								onClick={() => setShowDisclosure(true)}
								style={disclosureTriggerStyle}
							>
								<span style={disclosureHintStyle}>observer-only · 点击查看详情</span>
							</button>
						) : (
							<div style={disclosureContentStyle}>
								<span style={disclosureTitleStyle}>只读观察模式</span>
								<span style={disclosureTextStyle}>当前阶段仅保留观察与进入能力</span>
								<button
									type="button"
									onClick={() => setShowDisclosure(false)}
									style={disclosureCloseStyle}
								>
									收起
								</button>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

function getRoleLabel(role: string): string {
	const labels: Record<string, string> = {
		user: "用户",
		assistant: "助手",
		tool: "工具",
		system: "系统",
		other: "其他",
	};
	return labels[role] || role;
}

function getContainerStyle(_isMobile: boolean): React.CSSProperties {
	return {
		height: "100%",
		display: "flex",
		flexDirection: "column",
		background: "#fff",
		color: "#1f2933",
		fontFamily:
			'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
		overflow: "hidden",
	};
}

const agentHeaderStyle: React.CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	padding: "0.75rem 1rem",
	background: "#fff",
	borderBottom: "1px solid #e5e7eb",
	flexShrink: 0,
};

const agentHeaderTitleStyle: React.CSSProperties = {
	fontSize: "1rem",
	fontWeight: 600,
	color: "#111827",
};

const agentHeaderStatusStyle: React.CSSProperties = {
	fontSize: "0.75rem",
	color: "#6b7280",
};

function getWorkspaceLayoutStyle(isMobile: boolean): React.CSSProperties {
	return {
		flex: 1,
		display: "flex",
		flexDirection: isMobile ? "column" : "row",
		minHeight: 0,
		overflow: "hidden",
	};
}

function getLeftSidebarStyle(isMobile: boolean): React.CSSProperties {
	return {
		width: isMobile ? "100%" : "220px",
		flexShrink: 0,
		display: "flex",
		flexDirection: "column",
		background: "#f8fafc",
		borderRight: isMobile ? "none" : "1px solid #e5e7eb",
		borderBottom: isMobile ? "1px solid #e5e7eb" : "none",
		overflow: "hidden",
	};
}

const channelAreaStyle: React.CSSProperties = {
	padding: "0.75rem",
	borderBottom: "1px solid #e5e7eb",
	flexShrink: 0,
};

const sessionListAreaStyle: React.CSSProperties = {
	flex: 1,
	padding: "0.75rem",
	overflow: "auto",
	minHeight: 0,
};

const sectionLabelStyle: React.CSSProperties = {
	fontSize: "0.6875rem",
	fontWeight: 600,
	color: "#9ca3af",
	textTransform: "uppercase",
	letterSpacing: "0.05em",
	display: "block",
	marginBottom: "0.5rem",
};

const requestCluesWrapStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "0.4rem",
};

const requestCluesBoxStyle: React.CSSProperties = {
	display: "flex",
	flexWrap: "wrap",
	gap: "0.5rem",
	padding: "0.75rem 0.875rem",
	borderRadius: "0.75rem",
	border: "1px solid #e5e7eb",
	background: "#f8fafc",
};

const requestClueTextStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.75rem",
	color: "#6b7280",
	fontFamily: 'ui-monospace, SFMono-Regular, "SFMono-Regular", Consolas, monospace',
};

const placeholderTextStyle: React.CSSProperties = {
	fontSize: "0.75rem",
	color: "#9ca3af",
};

const sidebarErrorTextStyle: React.CSSProperties = {
	fontSize: "0.75rem",
	color: "#b45309",
	lineHeight: 1.5,
};

const warningNoticeStyle: React.CSSProperties = {
	padding: "0.875rem 1rem",
	borderRadius: "0.75rem",
	border: "1px solid #e6c589",
	background: "rgba(255, 248, 230, 0.9)",
	display: "flex",
	flexDirection: "column",
	gap: "0.35rem",
};

const infoNoticeStyle: React.CSSProperties = {
	padding: "0.875rem 1rem",
	borderRadius: "0.75rem",
	border: "1px solid #b8d4de",
	background: "rgba(237, 247, 250, 0.92)",
	display: "flex",
	flexDirection: "column",
	gap: "0.35rem",
};

const statusCardStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "0.35rem",
	padding: "1rem",
	borderRadius: "0.75rem",
	background: "#fff",
	border: "1px solid #e5e7eb",
	maxWidth: "480px",
	margin: "0 auto",
};

const statusCardTitleStyle: React.CSSProperties = {
	fontSize: "0.875rem",
	color: "#1f2933",
};

const statusCardDetailStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.75rem",
	color: "#6b7280",
	lineHeight: 1.5,
};

const sessionListStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "0.25rem",
};

function getSessionItemStyle(isSelected: boolean): React.CSSProperties {
	return {
		padding: "0.5rem 0.625rem",
		fontSize: "0.8125rem",
		textAlign: "left",
		border: "none",
		borderRadius: "0.375rem",
		background: isSelected ? "#e0e7ff" : "transparent",
		color: isSelected ? "#3730a3" : "#1f2933",
		cursor: "pointer",
		transition: "background 0.15s",
		whiteSpace: "nowrap",
		overflow: "hidden",
		textOverflow: "ellipsis",
	};
}

function getMainContentStyle(isMobile: boolean): React.CSSProperties {
	return {
		flex: 1,
		display: "flex",
		flexDirection: "column",
		minHeight: 0,
		padding: isMobile ? "0.5rem" : "0.75rem",
		gap: isMobile ? "0.5rem" : "0.75rem",
		overflow: "hidden",
	};
}

const loadingContainerStyle: React.CSSProperties = {
	flex: 1,
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
};

const loadingTextStyle: React.CSSProperties = {
	fontSize: "0.9375rem",
	color: "#6b7280",
};

function getMessagesContainerStyle(isMobile: boolean): React.CSSProperties {
	return {
		flex: 1,
		display: "flex",
		flexDirection: "column",
		minHeight: 0,
		background: "#f8fafc",
		border: "1px solid #e5e7eb",
		borderRadius: "0.75rem",
		overflow: "hidden",
		padding: isMobile ? "0.5rem" : "0.75rem",
	};
}

const messagesAreaStyle: React.CSSProperties = {
	flex: 1,
	overflow: "auto",
};

const messagesEmptyStyle: React.CSSProperties = {
	height: "100%",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
};

const messagesEmptyTextStyle: React.CSSProperties = {
	fontSize: "0.875rem",
	color: "#9ca3af",
};

function getInputShellStyle(isMobile: boolean): React.CSSProperties {
	return {
		flexShrink: 0,
		padding: isMobile ? "0.625rem 0.75rem" : "0.75rem 1rem",
		background: "#f8fafc",
		border: "1px solid #e5e7eb",
		borderRadius: "0.75rem",
		textAlign: "center",
	};
}

const disclosureTriggerStyle: React.CSSProperties = {
	display: "inline-flex",
	alignItems: "center",
	gap: "0.25rem",
	padding: "0.375rem 0.75rem",
	border: "none",
	background: "transparent",
	color: "#9ca3af",
	fontSize: "0.75rem",
	cursor: "pointer",
	borderRadius: "0.375rem",
	transition: "color 0.15s, background 0.15s",
};

const disclosureHintStyle: React.CSSProperties = {
	fontSize: "0.75rem",
};

const disclosureContentStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	gap: "0.375rem",
};

const disclosureTitleStyle: React.CSSProperties = {
	fontSize: "0.75rem",
	fontWeight: 600,
	color: "#475569",
};

const disclosureTextStyle: React.CSSProperties = {
	fontSize: "0.75rem",
	color: "#6b7280",
};

const disclosureCloseStyle: React.CSSProperties = {
	marginTop: "0.25rem",
	padding: "0.25rem 0.5rem",
	fontSize: "0.6875rem",
	color: "#6b7280",
	background: "#fff",
	border: "1px solid #e5e7eb",
	borderRadius: "0.25rem",
	cursor: "pointer",
};

function getPreviewItemStyle(role: string): React.CSSProperties {
	const isUser = role === "user";
	return {
		padding: "0.625rem 0.875rem",
		borderRadius: "0.5rem",
		background: isUser ? "#eff6ff" : "#fff",
		marginBottom: "0.5rem",
		maxWidth: "85%",
		alignSelf: isUser ? "flex-end" : "flex-start",
		border: "1px solid #e5e7eb",
	};
}

const previewListStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "0.25rem",
};

const previewRoleStyle: React.CSSProperties = {
	fontSize: "0.625rem",
	fontWeight: 600,
	color: "#6b7280",
	textTransform: "uppercase",
	marginBottom: "0.25rem",
	display: "block",
};

const previewTextStyle: React.CSSProperties = {
	fontSize: "0.875rem",
	color: "#1f2933",
	margin: 0,
	lineHeight: 1.5,
	whiteSpace: "pre-wrap",
	wordBreak: "break-word",
};
