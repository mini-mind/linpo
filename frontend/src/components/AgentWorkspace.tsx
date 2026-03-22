import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
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
	type SessionListItem,
	type SessionPreviewItem,
	type SessionsPreviewResponse,
	type TopologyNode,
} from "../api/types";
import { useIsMobile } from "../hooks/useIsMobile";

interface AgentWorkspaceProps {
	agentId?: string;
	instanceId?: string;
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

function withErrorMessage(error: unknown, fallback: string): string {
	return error instanceof Error ? error.message : fallback;
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
	if (
		preferredKey &&
		sessions.some((session) => session.key === preferredKey)
	) {
		return preferredKey;
	}

	if (currentKey && sessions.some((session) => session.key === currentKey)) {
		return currentKey;
	}

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
	const [error, setError] = useState<string | null>(null);
	const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(null);
	const [previewItems, setPreviewItems] = useState<SessionPreviewItem[]>([]);
	const [previewLoading, setPreviewLoading] = useState(false);
	const [sessions, setSessions] = useState<SessionListItem[]>([]);
	const [showDisclosure, setShowDisclosure] = useState(false);

	const messagesAreaRef = useRef<HTMLDivElement | null>(null);
	const sessionRealtimeRef = useRef<ObserverRealtimeClient | null>(null);
	const prevSessionKeyRef = useRef<string | null>(null);

	useEffect(() => {
		if (!agentId) {
			setSelectedSessionKey(null);
			setPreviewItems([]);
			setPreviewLoading(false);
			setSessions([]);
			prevSessionKeyRef.current = null;
			return;
		}
		setSelectedSessionKey(null);
		setPreviewItems([]);
		setPreviewLoading(false);
		setSessions([]);
		prevSessionKeyRef.current = null;
	}, [agentId]);

	useEffect(() => {
		if (!agentId) return;
		let cancelled = false;
		async function fetchSessionState(): Promise<void> {
			try {
				const { sessions: nextSessions } = await listSessions(agentId, {
					instanceId,
				});
				if (!cancelled) {
					setSessions(nextSessions);
					setSelectedSessionKey((currentKey) =>
						resolveSelectedSessionKey(nextSessions, currentKey),
					);
					if (nextSessions.length === 0) {
						setPreviewItems([]);
						setPreviewLoading(false);
						prevSessionKeyRef.current = null;
					}
				}
			} catch {
				if (!cancelled) {
					setSessions([]);
					setSelectedSessionKey(null);
					setPreviewItems([]);
					setPreviewLoading(false);
					prevSessionKeyRef.current = null;
				}
			}
		}
		void fetchSessionState();
		return () => {
			cancelled = true;
		};
	}, [agentId, instanceId]);

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
			try {
				const response = await previewSessions([sessionKey], { instanceId });
				if (!cancelled) {
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
			} catch {
				if (!cancelled) {
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
				return;
			}
			setPreviewLoading(true);
			try {
				const response = await previewSessions([sessionKey], { instanceId });
				const nextItems = getPreviewItemsForSession(response, sessionKey);
				setPreviewItems((previousItems) =>
					arePreviewItemsEqual(previousItems, nextItems)
						? previousItems
						: nextItems,
				);
				if (nextItems.length > 0) {
					scrollToBottom();
				}
			} catch {
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
			setError("未提供实例 ID");
			setLoading(false);
			return;
		}
		setLoading(true);
		setError(null);
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
				if (!cancelled)
					setError(err instanceof Error ? err.message : "获取实例失败");
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

	if (error) {
		return (
			<div style={getContainerStyle(isMobile)} data-testid="session-stream-shell">
				<div style={loadingContainerStyle}>
					<span style={errorTextStyle}>错误: {error}</span>
				</div>
			</div>
		);
	}

	if (!agent) {
		return (
			<div style={getContainerStyle(isMobile)} data-testid="session-stream-shell">
				<div style={loadingContainerStyle}>
					<span style={loadingTextStyle}>未找到实例</span>
				</div>
			</div>
		);
	}

	const emptySessionText = selectedSessionKey ? "暂无消息" : "暂无可用会话";

	return (
		<div style={getContainerStyle(isMobile)} data-testid="session-stream-shell">
			<div style={getStreamLayoutStyle(isMobile)}>
				{sessions.length > 1 && (
					<div style={sessionSwitcherStyle}>
						<select
							value={selectedSessionKey ?? ""}
							onChange={(e) => {
								const key = e.target.value;
								if (key) {
									setSelectedSessionKey(key);
									setPreviewItems([]);
									setPreviewLoading(true);
								}
							}}
							style={sessionSelectStyle}
						>
							{sessions.map((session) => (
								<option key={session.key} value={session.key}>
									{session.derived_title || session.label || session.key}
								</option>
							))}
						</select>
					</div>
				)}

				<div style={getMessagesContainerStyle(isMobile)}>
					<div ref={messagesAreaRef} style={messagesAreaStyle}>
						{previewLoading ? (
							<div style={messagesEmptyStyle}>
								<span style={messagesEmptyTextStyle}>加载消息...</span>
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

				<div data-testid="session-input-shell" style={getInputShellStyle(isMobile)}>
					{!showDisclosure && (
						<button
							type="button"
							onClick={() => setShowDisclosure(true)}
							style={disclosureTriggerStyle}
						>
							<span style={disclosureHintStyle}>observer-only · 点击查看详情</span>
						</button>
					)}
					{showDisclosure && (
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

const errorTextStyle: React.CSSProperties = {
	fontSize: "0.9375rem",
	color: "#dc2626",
};

function getStreamLayoutStyle(isMobile: boolean): React.CSSProperties {
	return {
		flex: 1,
		display: "flex",
		flexDirection: "column",
		minHeight: 0,
		padding: isMobile ? "0.75rem" : "1rem",
		gap: isMobile ? "0.5rem" : "0.75rem",
	};
}

const sessionSwitcherStyle: React.CSSProperties = {
	flexShrink: 0,
};

const sessionSelectStyle: React.CSSProperties = {
	width: "100%",
	padding: "0.5rem 0.75rem",
	fontSize: "0.875rem",
	fontWeight: 500,
	borderRadius: "0.5rem",
	border: "1px solid #e5e7eb",
	background: "#f8fafc",
	color: "#1f2933",
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