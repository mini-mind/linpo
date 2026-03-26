import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
	ApiError,
	deleteSession,
	getAgentDetail,
	getDefaultObserverDataSource,
	getSessionHistory,
	listSessions,
	pauseSession,
	resetSession,
	sendChatMessage,
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
	type TopologyNode,
} from "../api/types";
import { useIsMobile } from "../hooks/useIsMobile";
import { useToast } from "../hooks/useToast";
import { MarkdownMessage } from "./MarkdownMessage";
import { SessionActions } from "./SessionActions";

interface AgentWorkspaceProps {
	agentId?: string;
	instanceId?: string;
	preferredSessionKey?: string | null;
}

interface RealtimeState {
	status: "realtime" | "reconnecting" | "resyncing" | "disconnected" | "error";
	message: string | null;
}

interface ChannelSummary {
	key: string;
	label: string;
	sessionCount: number;
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
	"getAgentDetail -> listSessions -> chat.history (+ realtime after selection)";

function withErrorMessage(error: unknown, fallback: string): string {
	return error instanceof Error ? error.message : fallback;
}

function getSessionActionErrorMessage(
	error: unknown,
	actionLabel: string,
): string {
	if (error instanceof ApiError && error.status === 404) {
		return `后端暂未提供${actionLabel}接口`;
	}
	return withErrorMessage(error, `${actionLabel}失败`);
}

function ensureError(error: unknown, fallback: string): Error {
	return error instanceof Error ? error : new Error(fallback);
}

function getErrorEnvelope(error: Error | null): ErrorEnvelope | null {
	return error instanceof ApiError ? error.envelope : null;
}

function describeReadStep(args: {
	step: "getAgentDetail" | "listSessions" | "chat.history";
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
			label: "当前 endpoints 未返回 freshness；仅在 list/history ts 可用时做推断",
			stale: false,
		};
	}

	const source = previewTs !== null ? "chatHistory.ts" : "listSessions.ts";
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

function getChannelKeyFromSessionKey(sessionKey: string): string {
	const delimiterIndex = sessionKey.indexOf(":");
	if (delimiterIndex <= 0) return sessionKey;
	return sessionKey.slice(0, delimiterIndex);
}

function getChannelLabelFromSession(session: SessionListItem): string {
	if (session.kind === "direct") return "direct";
	if (session.kind === "group") return "group";
	if (session.kind === "global") return "global";
	return getChannelKeyFromSessionKey(session.key);
}

function buildChannelSummaries(sessions: SessionListItem[]): ChannelSummary[] {
	const channelMap = new Map<string, ChannelSummary>();
	for (const session of sessions) {
		const key = getChannelKeyFromSessionKey(session.key);
		const existing = channelMap.get(key);
		if (existing) {
			existing.sessionCount += 1;
			continue;
		}
		channelMap.set(key, {
			key,
			label: getChannelLabelFromSession(session),
			sessionCount: 1,
		});
	}
	return [...channelMap.values()].sort((left, right) =>
		left.label.localeCompare(right.label, "en"),
	);
}

export function getHistoryItems(response: {
	ts?: number;
	items?: SessionPreviewItem[];
}): SessionPreviewItem[] {
	return Array.isArray(response.items) ? response.items : [];
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
	const { addToast } = useToast();
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
	const [draftMessage, setDraftMessage] = useState("");
	const [sendBusy, setSendBusy] = useState(false);

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
			setDraftMessage("");
			setSendBusy(false);
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
		setDraftMessage("");
		setSendBusy(false);
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

	const sendUserMessage = useCallback((): void => {
		const currentAgentId = agentId;
		const sessionKey = selectedSessionKey;
		const message = draftMessage.trim();
		if (!currentAgentId) return;
		if (!sessionKey) return;
		if (!message) return;
		if (sendBusy) return;

		setSendBusy(true);
		void sendChatMessage(
			{
				agentId: currentAgentId,
				sessionKey,
				message,
			},
			{ instanceId },
		)
			.then(() => {
				setDraftMessage("");
				scrollToBottom();
			})
			.catch((error: unknown) => {
				addToast(withErrorMessage(error, "发送消息失败"), "error");
			})
			.finally(() => {
				setSendBusy(false);
			});
	}, [
		agentId,
		selectedSessionKey,
		draftMessage,
		sendBusy,
		scrollToBottom,
		addToast,
		instanceId,
	]);

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
				const response = await getSessionHistory(sessionKey, { instanceId });
				if (!cancelled) {
					setPreviewTs(response.ts);
					setPreviewError(null);
					const nextItems = getHistoryItems(response);
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
					setPreviewError(ensureError(error, "读取会话历史失败"));
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
				const response = await getSessionHistory(sessionKey, { instanceId });
				setPreviewTs(response.ts);
				setPreviewError(null);
				const nextItems = getHistoryItems(response);
				setPreviewItems((previousItems) =>
					arePreviewItemsEqual(previousItems, nextItems)
						? previousItems
						: nextItems,
				);
				if (nextItems.length > 0) {
					scrollToBottom();
				}
			} catch (error) {
				setPreviewError(ensureError(error, "读取会话历史失败"));
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

	const handlePauseSession = useCallback(async (): Promise<void> => {
		const sessionKey = selectedSessionKey;
		if (!sessionKey) return;
		try {
			await pauseSession(
				{ sessionKey, agentId: agentId ?? undefined },
				{ instanceId },
			);
			addToast("已发送暂停请求", "success");
		} catch (error) {
			const message = getSessionActionErrorMessage(error, "暂停");
			addToast(message, "error");
			throw ensureError(error, message);
		}
	}, [selectedSessionKey, agentId, instanceId, addToast]);

	const handleResetSession = useCallback(async (): Promise<void> => {
		const sessionKey = selectedSessionKey;
		if (!sessionKey) return;
		try {
			await resetSession(sessionKey, { instanceId });
			await refreshPreview(sessionKey);
			addToast("会话已重置", "success");
		} catch (error) {
			const message = getSessionActionErrorMessage(error, "重置会话");
			addToast(message, "error");
			throw ensureError(error, message);
		}
	}, [selectedSessionKey, instanceId, refreshPreview, addToast]);

	const handleDeleteSession = useCallback(async (): Promise<void> => {
		const sessionKey = selectedSessionKey;
		if (!sessionKey) return;
		try {
			await deleteSession(sessionKey, { instanceId });
			const nextSessionKey = getFallbackSessionKeyAfterDelete(sessions, sessionKey);
			setSessions((previous) =>
				previous.filter((session) => session.key !== sessionKey),
			);
			setSelectedSessionKey(nextSessionKey);
			if (nextSessionKey) {
				await refreshPreview(nextSessionKey);
			} else {
				setPreviewItems([]);
				setPreviewLoading(false);
				setPreviewError(null);
				setPreviewTs(null);
				prevSessionKeyRef.current = null;
			}
			addToast("会话已删除", "success");
		} catch (error) {
			const message = getSessionActionErrorMessage(error, "删除会话");
			addToast(message, "error");
			throw ensureError(error, message);
		}
	}, [selectedSessionKey, instanceId, sessions, refreshPreview, addToast]);

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
			step: "chat.history",
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
	const diagnosticReason = unauthorizedEnvelope?.message ?? null;
	const showPartialFailure =
		!unauthorizedEnvelope && Boolean(agent) && Boolean(sessionsError || previewError);
	const shellTitle = agent?.id ?? agentId ?? "unknown-agent";
	const shellStatus = unauthorizedEnvelope
		? "○ 读取受限"
		: agent?.is_active
			? "● 运行中"
			: "○ 已停止";
	const emptySessionText = selectedSessionKey ? "暂无消息" : "当前工作区暂无可用会话";
	const displayedPreviewItems = previewItems;
	const channelSummaries = useMemo(() => buildChannelSummaries(sessions), [sessions]);
	const selectedChannelKey = selectedSessionKey
		? getChannelKeyFromSessionKey(selectedSessionKey)
		: null;

	useEffect(() => {
		if (loading) return;
		console.info("[AgentWorkspace] request/freshness/diagnostics", {
			request: requestIdClue,
			freshness: freshness.label,
			diagnostics: diagnosticsClue,
			readChain: SESSION_READ_CHAIN_CLUE,
			diagnosticReason,
		});
	}, [loading, requestIdClue, freshness.label, diagnosticsClue, diagnosticReason]);

	if (loading) {
		return (
			<div style={getContainerStyle(isMobile)} data-testid="session-stream-shell">
				<div style={loadingContainerStyle}>
					<span style={loadingTextStyle}>加载中...</span>
				</div>
			</div>
		);
	}

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
						<div style={getSidebarSectionHeaderStyle(isMobile)}>
							<span style={sectionLabelStyle}>渠道</span>
						</div>
						<div style={getSidebarSectionBodyStyle(isMobile)}>
							{sessionsError ? (
								<span style={sidebarErrorTextStyle}>
									渠道汇总失败：{sessionsError.message}
								</span>
							) : channelSummaries.length === 0 ? (
								<span style={placeholderTextStyle}>暂无渠道</span>
							) : (
								<div style={getChannelListStyle(isMobile)}>
									{channelSummaries.map((channel) => (
										<span
											key={channel.key}
											style={getChannelBadgeStyle(channel.key === selectedChannelKey)}
										>
											{channel.label} · {channel.sessionCount}
										</span>
									))}
								</div>
							)}
						</div>
					</div>

					<div data-testid="session-list-area" style={sessionListAreaStyle}>
						<div style={getSidebarSectionHeaderStyle(isMobile)}>
							<span style={sectionLabelStyle}>会话</span>
						</div>
						<div style={getSidebarSectionBodyStyle(isMobile)}>
							{sessionsError ? (
								<span style={sidebarErrorTextStyle}>
									会话列表读取失败：{sessionsError.message}
								</span>
							) : sessions.length === 0 ? (
								<span style={placeholderTextStyle}>暂无会话</span>
							) : (
								<div style={getSessionListStyle(isMobile)}>
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

					<div data-testid="session-actions-area" style={sessionActionsAreaStyle}>
						<div style={getSidebarSectionHeaderStyle(isMobile)}>
							<span style={sectionLabelStyle}>操作</span>
						</div>
						<div style={getSidebarSectionBodyStyle(isMobile)}>
							<SessionActions
								sessionKey={selectedSessionKey}
								onPause={handlePauseSession}
								onReset={handleResetSession}
								onDelete={handleDeleteSession}
								showPauseButton={Boolean(agent?.is_active)}
								disabled={!selectedSessionKey || Boolean(unauthorizedEnvelope)}
							/>
						</div>
					</div>
				</div>

				<div style={getMainContentStyle(isMobile)}>
					{showPartialFailure ? (
						<div style={warningNoticeStyle}>
							<strong style={statusCardTitleStyle}>会话下游读取失败</strong>
							<p style={statusCardDetailStyle}>
								{sessionsError
									? `会话列表读取失败：${sessionsError.message}`
									: `chat.history 失败：${previewError?.message ?? "unknown error"}`}
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
								当前 session 没有 aggregate freshness；此处仅根据最近一次 list/history ts 推断。
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
									<strong style={statusCardTitleStyle}>当前会话历史不可用</strong>
									<p style={statusCardDetailStyle}>
										chat.history 失败：{previewError.message}
									</p>
								</div>
							) : displayedPreviewItems.length === 0 ? (
								<div style={messagesEmptyStyle}>
									<span style={messagesEmptyTextStyle}>{emptySessionText}</span>
								</div>
							) : (
								<div style={previewListStyle}>
									{displayedPreviewItems.map((item, index) => (
										<div
											key={`msg-${index}-${item.role}`}
											style={getPreviewItemStyle(item.role, isMobile)}
										>
										<span style={previewRoleStyle}>
											{getRoleLabel(item.role)}
										</span>
										<MarkdownMessage text={item.text} style={previewTextStyle} />
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
						) : (
							<div style={getComposerWrapStyle(isMobile)}>
								<label style={visuallyHiddenLabelStyle} htmlFor="session-message-input">
									消息输入
								</label>
							<textarea
								id="session-message-input"
								aria-label="消息输入"
									placeholder={
										selectedSessionKey ? "输入消息..." : "暂无可用会话，暂不可发送"
									}
								value={draftMessage}
								onChange={(event) => setDraftMessage(event.currentTarget.value)}
								onKeyDown={(event) => {
									if (event.key !== "Enter") return;
									if (event.shiftKey) return;
									event.preventDefault();
									sendUserMessage();
								}}
								disabled={!selectedSessionKey || sendBusy}
								rows={isMobile ? 2 : 3}
								style={composerInputStyle}
							/>
							<button
								type="button"
								onClick={sendUserMessage}
								disabled={!selectedSessionKey || sendBusy || draftMessage.trim().length === 0}
								style={getSendButtonStyle(!selectedSessionKey || sendBusy)}
							>
								发送
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
		width: "100%",
		maxWidth: "none",
		marginLeft: 0,
		marginRight: 0,
		paddingLeft: 0,
		paddingRight: 0,
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
		background: isMobile ? "#f8fafc" : "#fff",
	};
}

function getLeftSidebarStyle(isMobile: boolean): React.CSSProperties {
	return {
		width: isMobile ? "100%" : "248px",
		marginLeft: 0,
		marginRight: 0,
		paddingLeft: 0,
		paddingRight: 0,
		flexShrink: 0,
		display: "flex",
		flexDirection: "column",
		background: isMobile ? "#ffffff" : "#f4f6f8",
		borderRight: isMobile ? "none" : "1px solid #e5e7eb",
		borderBottom: isMobile ? "1px solid #e5e7eb" : "none",
		maxHeight: isMobile ? "44dvh" : "none",
		overflow: isMobile ? "auto" : "hidden",
	};
}

const channelAreaStyle: React.CSSProperties = {
	padding: 0,
	borderBottom: "1px solid #e5e7eb",
	flexShrink: 0,
};

const sessionListAreaStyle: React.CSSProperties = {
	flex: 1,
	padding: 0,
	overflow: "auto",
	minHeight: 0,
};

const sessionActionsAreaStyle: React.CSSProperties = {
	borderTop: "1px solid #e5e7eb",
	flexShrink: 0,
};

const sectionLabelStyle: React.CSSProperties = {
	fontSize: "0.6875rem",
	fontWeight: 600,
	color: "#9ca3af",
	textTransform: "uppercase",
	letterSpacing: "0.05em",
	display: "block",
	marginBottom: 0,
};

const requestClueTextStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.75rem",
	color: "#6b7280",
	fontFamily: 'ui-monospace, SFMono-Regular, "SFMono-Regular", Consolas, monospace',
};

function getSidebarSectionHeaderStyle(isMobile: boolean): React.CSSProperties {
	return {
		padding: isMobile ? "0.625rem 0.625rem 0.25rem" : "0.75rem 0.75rem 0.375rem",
	};
}

function getSidebarSectionBodyStyle(isMobile: boolean): React.CSSProperties {
	return {
		padding: isMobile ? "0 0.625rem 0.625rem" : "0 0.75rem 0.75rem",
	};
}

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

function getSessionListStyle(isMobile: boolean): React.CSSProperties {
	return {
		display: "flex",
		flexDirection: isMobile ? "row" : "column",
		gap: "0.25rem",
		overflowX: isMobile ? "auto" : "visible",
		overflowY: "visible",
		paddingBottom: isMobile ? "0.125rem" : 0,
	};
}

function getChannelListStyle(isMobile: boolean): React.CSSProperties {
	return {
		display: "flex",
		flexWrap: isMobile ? "nowrap" : "wrap",
		gap: "0.375rem",
		overflowX: isMobile ? "auto" : "visible",
	};
}

function getChannelBadgeStyle(isSelected: boolean): React.CSSProperties {
	return {
		display: "inline-flex",
		alignItems: "center",
		padding: "0.1875rem 0.5rem",
		borderRadius: "999px",
		border: isSelected ? "1px solid #3730a3" : "1px solid #d1d5db",
		background: isSelected ? "#e0e7ff" : "#f8fafc",
		color: isSelected ? "#312e81" : "#475569",
		fontSize: "0.6875rem",
		fontWeight: 600,
	};
}

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
		padding: isMobile ? "0.625rem 0.625rem 0" : 0,
		gap: isMobile ? "0.5rem" : 0,
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
		width: "100%",
		maxWidth: isMobile ? "none" : "960px",
		marginLeft: isMobile ? 0 : "auto",
		marginRight: isMobile ? 0 : "auto",
		display: "flex",
		flexDirection: "column",
		minHeight: 0,
		background: isMobile ? "#f8fafc" : "#fff",
		border: "none",
		borderRadius: 0,
		overflow: "hidden",
		padding: isMobile ? "0.5rem" : 0,
		paddingLeft: isMobile ? "0.5rem" : 0,
		paddingRight: isMobile ? "0.5rem" : 0,
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
		width: "100%",
		maxWidth: isMobile ? "none" : "960px",
		marginLeft: isMobile ? 0 : "auto",
		marginRight: isMobile ? 0 : "auto",
		padding: 0,
		paddingLeft: 0,
		paddingRight: 0,
		paddingBottom: isMobile ? "calc(0.5rem + env(safe-area-inset-bottom))" : 0,
		background: "#fff",
		border: "none",
		borderTop: isMobile ? "1px solid #e5e7eb" : "none",
		borderRadius: 0,
		boxShadow: isMobile ? "0 -8px 20px rgba(15, 23, 42, 0.06)" : "none",
		textAlign: "left",
		position: isMobile ? "sticky" : "static",
		bottom: isMobile ? 0 : "auto",
		zIndex: isMobile ? 2 : "auto",
	};
}

const visuallyHiddenLabelStyle: React.CSSProperties = {
	position: "absolute",
	width: "1px",
	height: "1px",
	padding: 0,
	margin: "-1px",
	overflow: "hidden",
	clip: "rect(0, 0, 0, 0)",
	whiteSpace: "nowrap",
	border: 0,
};

function getComposerWrapStyle(isMobile: boolean): React.CSSProperties {
	return {
		display: "flex",
		alignItems: "flex-end",
		gap: "0.5rem",
		padding: isMobile ? "0.625rem 0.25rem 0.25rem" : "0.625rem 0.75rem 0.25rem",
	};
}

const composerInputStyle: React.CSSProperties = {
	flex: 1,
	resize: "none",
	borderRadius: "0.75rem",
	border: "1px solid #e2e8f0",
	padding: "0.625rem 0.75rem",
	fontSize: "0.875rem",
	lineHeight: 1.4,
	outline: "none",
	background: "#fff",
};

function getSendButtonStyle(isDisabled: boolean): React.CSSProperties {
	return {
		flexShrink: 0,
		padding: "0.625rem 0.875rem",
		borderRadius: "0.75rem",
		border: "1px solid #e5e7eb",
		background: isDisabled ? "#f1f5f9" : "#111827",
		color: isDisabled ? "#94a3b8" : "#fff",
		fontSize: "0.875rem",
		fontWeight: 600,
		cursor: isDisabled ? "not-allowed" : "pointer",
	};
}

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

function getPreviewItemStyle(role: string, isMobile: boolean): React.CSSProperties {
	const isUser = role === "user";
	return {
		padding: "0.625rem 0.875rem",
		borderRadius: "18px",
		background: isUser ? "#eff6ff" : "#fff",
		marginBottom: "0.5rem",
		maxWidth: isMobile ? "92%" : "78%",
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
