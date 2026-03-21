import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
	getAgentDetail,
	getDefaultObserverDataSource,
	getNodeDetail,
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
	type EventRecord,
	type NodeDetailResponse,
	type SessionListItem,
	type SessionPreviewItem,
	type SessionsPreviewResponse,
	type TopologyNode,
} from "../api/types";
import { useIsMobile } from "../hooks/useIsMobile";
import { SessionActions } from "./SessionActions";
import { SessionList } from "./SessionList";

type RealtimeStatus =
	| "realtime"
	| "reconnecting"
	| "resyncing"
	| "disconnected"
	| "error";
type WorkspaceTab = "session" | "status" | "logs" | "files";

interface AgentWorkspaceProps {
	agentId?: string;
}

interface RealtimeState {
	status: RealtimeStatus;
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

const STATUS_BADGE_CN: Record<string, string> = {
	idle: "空闲",
	running: "运行中",
	finished: "已完成",
	error: "错误",
};

const EVENT_TYPE_CN: Record<string, string> = {
	agent_created: "代理创建",
	subagent_created: "子代理创建",
	activity_started: "活动开始",
	activity_stopped: "活动停止",
	status_changed: "状态变更",
	node_finished: "节点完成",
	task_started: "任务开始",
	task_finished: "任务完成",
	task_interrupted: "任务中断",
};

export function AgentWorkspace(props: AgentWorkspaceProps): JSX.Element {
	const { agentId: paramAgentId } = useParams<{ agentId: string }>();
	const agentId = props.agentId ?? paramAgentId;
	const isMobile = useIsMobile();
	const [agent, setAgent] = useState<AgentDetailResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [activeTab, setActiveTab] = useState<WorkspaceTab>("session");
	const [nodeDetail, setNodeDetail] = useState<NodeDetailResponse | null>(null);
	const [nodeDetailLoading, setNodeDetailLoading] = useState(false);
	const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(
		null,
	);
	const [previewItems, setPreviewItems] = useState<SessionPreviewItem[]>([]);
	const [previewLoading, setPreviewLoading] = useState(false);
	const [sessions, setSessions] = useState<SessionListItem[]>([]);

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
		if (activeTab !== "session" || !agentId) return;
		let cancelled = false;
		async function fetchSessionState(): Promise<void> {
			try {
				const { sessions: nextSessions } = await listSessions(agentId);
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
	}, [activeTab, agentId]);

	const scrollToBottom = useCallback(() => {
		setTimeout(() => {
			if (messagesAreaRef.current) {
				messagesAreaRef.current.scrollTop =
					messagesAreaRef.current.scrollHeight;
			}
		}, 0);
	}, []);

	useEffect(() => {
		if (activeTab !== "session" || !selectedSessionKey) return;
		const sessionKey = selectedSessionKey;

		if (prevSessionKeyRef.current === sessionKey) return;
		prevSessionKeyRef.current = sessionKey;

		let cancelled = false;

		async function fetchPreview(): Promise<void> {
			setPreviewLoading(true);
			try {
				const response = await previewSessions([sessionKey]);
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
	}, [activeTab, selectedSessionKey, scrollToBottom]);

	const refreshPreview = useCallback(
		async (sessionKey: string | null = selectedSessionKey): Promise<void> => {
			if (!sessionKey) {
				setPreviewItems([]);
				setPreviewLoading(false);
				return;
			}
			setPreviewLoading(true);
			try {
				const response = await previewSessions([sessionKey]);
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
		[selectedSessionKey, scrollToBottom],
	);

	useEffect(() => {
		if (activeTab !== "session" || !selectedSessionKey) {
			sessionRealtimeRef.current?.close();
			sessionRealtimeRef.current = null;
			return;
		}

		const sessionKey = selectedSessionKey;
		let cancelled = false;

		const startSessionRealtime = (): void => {
			const client = createObserverRealtimeClient({
				dataSource: AGENT_DETAIL_REALTIME_DATA_SOURCE,
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
	}, [activeTab, selectedSessionKey, refreshPreview, scrollToBottom]);

	const handleSessionSelect = useCallback(
		(sessionKey: string): void => {
			if (sessionKey === selectedSessionKey) return;
			setSelectedSessionKey(sessionKey);
			setPreviewItems([]);
			setPreviewLoading(true);
		},
		[selectedSessionKey],
	);

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
					getAgentDetailFn: getAgentDetail,
					createRealtimeClientFn: createObserverRealtimeClient,
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
	}, [agentId]);

	useEffect(() => {
		if (!agentId || !agent) return;
		const rootNodeId = agent.root_node_id || agent.nodes[0]?.id;
		if (!rootNodeId) return;
		const currentAgentId = agentId;
		let cancelled = false;

		async function fetchNodeDetail(nodeId: string): Promise<void> {
			setNodeDetailLoading(true);
			try {
				const detail = await getNodeDetail(currentAgentId, nodeId);
				if (!cancelled) setNodeDetail(detail);
			} catch {
			} finally {
				if (!cancelled) setNodeDetailLoading(false);
			}
		}

		void fetchNodeDetail(rootNodeId);
		return () => {
			cancelled = true;
		};
	}, [agentId, agent]);

	if (loading) {
		return (
			<div style={getContainerStyle(isMobile)}>
				<p style={textStyle}>加载中...</p>
			</div>
		);
	}

	if (error) {
		return (
			<div style={getContainerStyle(isMobile)}>
				<p style={errorStyle}>错误: {error}</p>
			</div>
		);
	}

	if (!agent) {
		return (
			<div style={getContainerStyle(isMobile)}>
				<p style={textStyle}>未找到实例</p>
			</div>
		);
	}

	const emptySessionText = selectedSessionKey ? "暂无消息" : "暂无可用会话";
	const emptySessionHint = selectedSessionKey
		? "当前阶段仅保留观察与进入能力"
		: "请选择其他会话或等待新消息进入";

	return (
		<div style={getContainerStyle(isMobile)}>
			<div style={getTabsStyle(isMobile)}>
				<button
					type="button"
					style={
						activeTab === "session"
							? getActiveTabStyle(isMobile)
							: getTabStyle(isMobile)
					}
					onClick={() => setActiveTab("session")}
				>
					消息
				</button>
				<button
					type="button"
					style={
						activeTab === "status"
							? getActiveTabStyle(isMobile)
							: getTabStyle(isMobile)
					}
					onClick={() => setActiveTab("status")}
				>
					状态
				</button>
				<button
					type="button"
					style={
						activeTab === "logs"
							? getActiveTabStyle(isMobile)
							: getTabStyle(isMobile)
					}
					onClick={() => setActiveTab("logs")}
				>
					日志
				</button>
				<button
					type="button"
					style={
						activeTab === "files"
							? getActiveTabStyle(isMobile)
							: getTabStyle(isMobile)
					}
					onClick={() => setActiveTab("files")}
					disabled
				>
					文件<span style={tabTagStyle}>v0.8</span>
				</button>
			</div>

			<div style={getContentStyle(isMobile)}>
				{activeTab === "session" && (
					<div style={getSessionLayoutStyle(isMobile)}>
						<section style={getSessionListPanelStyle(isMobile)}>
							<div style={sessionPanelHeaderStyle}>
								<div>
									<h2 style={sessionPanelTitleStyle}>会话列表</h2>
									<p style={sessionPanelHintStyle}>
										切换会话会同步更新预览与实时频道
									</p>
								</div>
								<span style={sessionCountBadgeStyle}>{sessions.length} 个</span>
							</div>
							<div style={sessionListWrapperStyle}>
								<SessionList
									sessions={sessions}
									selectedKey={selectedSessionKey}
									onSelect={handleSessionSelect}
								/>
							</div>
						</section>
						<div style={chatMainPaneStyle}>
							<div style={getSessionToolbarStyle(isMobile)}>
								<div style={sessionToolbarInfoStyle}>
									<span style={sessionToolbarLabelStyle}>当前会话</span>
									<span style={sessionToolbarKeyStyle}>
										{selectedSessionKey ?? "暂无可选会话"}
									</span>
								</div>
								{selectedSessionKey && (
									<SessionActions sessionKey={selectedSessionKey} />
								)}
							</div>
							<div style={getChatboxContainerStyle()}>
								<div style={getChatMessagesAreaStyle(isMobile)}>
									<div ref={messagesAreaRef} style={messagesAreaStyle}>
										{previewLoading ? (
											<div style={messagesEmptyStyle}>
												<span style={messagesEmptyTextStyle}>加载消息...</span>
											</div>
										) : previewItems.length === 0 ? (
											<div style={messagesEmptyStyle}>
												<span style={messagesEmptyTextStyle}>
													{emptySessionText}
												</span>
												<span style={messagesEmptyHintStyle}>
													{emptySessionHint}
												</span>
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
							</div>
						</div>
					</div>
				)}

				{activeTab === "status" && (
					<div style={detailTabStyle}>
						<div style={getTopRowStyle(isMobile)}>
							<section style={getSectionStyle(isMobile)}>
								<h2 style={getSectionTitleStyle(isMobile)}>当前状态</h2>
								<div style={getStatusGridStyle(isMobile)}>
									<div style={statusItemStyle}>
										<span style={statusLabelStyle}>节点 ID</span>
										<span style={statusValueStyle}>
											{agent.nodes[0]?.id || agent.id}
										</span>
									</div>
									<div style={statusItemStyle}>
										<span style={statusLabelStyle}>运行状态</span>
										<span style={getStatusBadgeStyle(agent.status)}>
											{STATUS_BADGE_CN[agent.status] || agent.status}
										</span>
									</div>
									<div style={statusItemStyle}>
										<span style={statusLabelStyle}>活跃状态</span>
										<span
											style={
												agent.is_active ? activeTextStyle : inactiveTextStyle
											}
										>
											{agent.is_active ? "● 活跃" : "○ 不活跃"}
										</span>
									</div>
									<div style={statusItemStyle}>
										<span style={statusLabelStyle}>子节点</span>
										<span style={statusValueStyle}>
											{agent.root_child_count} 个
										</span>
									</div>
									<div style={statusItemStyle}>
										<span style={statusLabelStyle}>总节点</span>
										<span style={statusValueStyle}>
											{agent.total_node_count} 个
										</span>
									</div>
									{nodeDetail?.last_active_started_at && (
										<div style={statusItemStyle}>
											<span style={statusLabelStyle}>最近活跃</span>
											<span style={statusValueStyle}>
												{formatTime(nodeDetail.last_active_started_at)}
											</span>
										</div>
									)}
								</div>
							</section>
							<section style={getSectionStyle(isMobile)}>
								<h2 style={getSectionTitleStyle(isMobile)}>资源占用</h2>
								<div style={placeholderSectionStyle}>
									<span style={placeholderTextStyle}>暂不支持</span>
									<span style={placeholderHintStyle}>
										需要 OpenClaw 提供资源监控接口
									</span>
								</div>
							</section>
						</div>
					</div>
				)}

				{activeTab === "logs" && (
					<div style={detailTabStyle}>
						<section style={getSectionStyle(isMobile)}>
							<h2 style={getSectionTitleStyle(isMobile)}>历史事件</h2>
							{nodeDetailLoading ? (
								<div style={emptyEventsStyle}>
									<p style={emptyEventsTextStyle}>加载中...</p>
								</div>
							) : nodeDetail?.events && nodeDetail.events.length > 0 ? (
								<ul style={eventListStyle}>
									{nodeDetail.events.map((event: EventRecord) => (
										<li key={event.id} style={eventItemStyle}>
											<div style={eventHeaderStyle}>
												<span style={eventTypeStyle}>
													{EVENT_TYPE_CN[event.type] || event.type}
												</span>
												<span style={eventTimeStyle}>
													{formatTime(event.timestamp)}
												</span>
											</div>
											<p style={eventDescStyle}>{event.description}</p>
										</li>
									))}
								</ul>
							) : (
								<div style={emptyEventsStyle}>
									<p style={emptyEventsTextStyle}>暂无历史事件</p>
								</div>
							)}
						</section>
					</div>
				)}

				{activeTab === "files" && (
					<div style={placeholderContentStyle}>
						<div style={getPlaceholderBoxStyle(isMobile)}>
							<h3 style={placeholderTitleStyle}>文件系统</h3>
							<p style={placeholderTextStyle}>此功能将在 v0.8 版本中提供。</p>
							<p style={placeholderHintStyle}>
								将支持浏览和编辑实例的工作目录文件。
							</p>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

function formatTime(timestamp: string): string {
	return new Date(timestamp).toLocaleString("zh-CN");
}

function getStatusBadgeStyle(status: string): React.CSSProperties {
	const colors: Record<string, { bg: string; text: string }> = {
		running: { bg: "#dcfce7", text: "#166534" },
		idle: { bg: "#f3f4f6", text: "#6b7280" },
		finished: { bg: "#dbeafe", text: "#1e40af" },
		error: { bg: "#fee2e2", text: "#dc2626" },
	};
	const c = colors[status] || colors.idle;
	return {
		display: "inline-block",
		padding: "0.25rem 0.75rem",
		borderRadius: "9999px",
		fontSize: "0.75rem",
		fontWeight: 500,
		background: c.bg,
		color: c.text,
	};
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

function getTabsStyle(isMobile: boolean): React.CSSProperties {
	return {
		display: "flex",
		alignItems: "center",
		gap: "0",
		padding: isMobile ? "0 0.75rem" : "0 1rem",
		background: "#fff",
		borderBottom: "1px solid #e5e7eb",
		overflowX: "auto",
		WebkitOverflowScrolling: "touch",
	};
}

function getTabStyle(isMobile: boolean): React.CSSProperties {
	return {
		display: "inline-flex",
		alignItems: "center",
		gap: "0.25rem",
		padding: isMobile ? "0.625rem 0.75rem" : "0.75rem 1rem",
		fontSize: isMobile ? "0.875rem" : "0.9375rem",
		fontWeight: 500,
		border: "none",
		borderBottom: "2px solid transparent",
		background: "transparent",
		color: "#6b7280",
		cursor: "pointer",
		whiteSpace: "nowrap",
		flexShrink: 0,
		transition: "color 0.15s, border-color 0.15s",
	};
}

function getActiveTabStyle(isMobile: boolean): React.CSSProperties {
	return {
		...getTabStyle(isMobile),
		borderBottom: "2px solid #3b82f6",
		color: "#1f2933",
	};
}

function getContentStyle(_isMobile: boolean): React.CSSProperties {
	return {
		flex: 1,
		display: "flex",
		flexDirection: "column",
		overflow: "hidden",
		minHeight: 0,
	};
}

function getSessionLayoutStyle(isMobile: boolean): React.CSSProperties {
	return {
		flex: 1,
		display: "flex",
		flexDirection: isMobile ? "column" : "row",
		gap: isMobile ? "0.75rem" : "1rem",
		padding: isMobile ? "0.75rem" : "1rem",
		background: "#f8fafc",
		minHeight: 0,
	};
}

function getSessionListPanelStyle(isMobile: boolean): React.CSSProperties {
	return {
		display: "flex",
		flexDirection: "column",
		width: isMobile ? "100%" : "18rem",
		flexShrink: 0,
		minHeight: isMobile ? "11rem" : 0,
		maxHeight: isMobile ? "15rem" : "100%",
		background: "#fff",
		border: "1px solid #e5e7eb",
		borderRadius: "0.75rem",
		overflow: "hidden",
	};
}

const sessionPanelHeaderStyle: React.CSSProperties = {
	display: "flex",
	justifyContent: "space-between",
	alignItems: "flex-start",
	gap: "0.75rem",
	padding: "0.875rem 1rem",
	borderBottom: "1px solid #e5e7eb",
	background: "#f8fafc",
};

const sessionPanelTitleStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.9375rem",
	fontWeight: 600,
	color: "#111827",
};

const sessionPanelHintStyle: React.CSSProperties = {
	margin: "0.25rem 0 0 0",
	fontSize: "0.75rem",
	color: "#6b7280",
	lineHeight: 1.5,
};

const sessionCountBadgeStyle: React.CSSProperties = {
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	padding: "0.25rem 0.5rem",
	borderRadius: "9999px",
	background: "#dbeafe",
	color: "#1d4ed8",
	fontSize: "0.75rem",
	fontWeight: 600,
	whiteSpace: "nowrap",
};

const sessionListWrapperStyle: React.CSSProperties = {
	flex: 1,
	minHeight: 0,
	overflow: "hidden",
};

const chatMainPaneStyle: React.CSSProperties = {
	flex: 1,
	display: "flex",
	flexDirection: "column",
	minWidth: 0,
	minHeight: 0,
	gap: "0.75rem",
};

function getSessionToolbarStyle(isMobile: boolean): React.CSSProperties {
	return {
		display: "flex",
		flexDirection: isMobile ? "column" : "row",
		justifyContent: "space-between",
		alignItems: isMobile ? "stretch" : "center",
		gap: "0.75rem",
		padding: isMobile ? "0.875rem" : "1rem",
		background: "#fff",
		border: "1px solid #e5e7eb",
		borderRadius: "0.75rem",
	};
}

const sessionToolbarInfoStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "0.25rem",
	minWidth: 0,
};

const sessionToolbarLabelStyle: React.CSSProperties = {
	fontSize: "0.75rem",
	fontWeight: 500,
	color: "#6b7280",
};

const sessionToolbarKeyStyle: React.CSSProperties = {
	fontSize: "0.875rem",
	fontWeight: 600,
	color: "#111827",
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
};

function getChatboxContainerStyle(): React.CSSProperties {
	return {
		display: "flex",
		flexDirection: "column",
		flex: 1,
		minHeight: 0,
		background: "#fff",
		border: "1px solid #e5e7eb",
		borderRadius: "0.75rem",
		overflow: "hidden",
		position: "relative",
	};
}

function getChatMessagesAreaStyle(isMobile: boolean): React.CSSProperties {
	return {
		flex: 1,
		display: "flex",
		flexDirection: "column",
		minWidth: 0,
		minHeight: 0,
		overflow: "hidden",
		paddingBottom: isMobile ? "1rem" : "1.25rem",
	};
}

function getSectionStyle(isMobile: boolean): React.CSSProperties {
	return {
		background: "#fffdf8",
		border: "1px solid #d6cfc2",
		borderRadius: "0.5rem",
		padding: isMobile ? "1rem" : "1.5rem",
	};
}

function getSectionTitleStyle(isMobile: boolean): React.CSSProperties {
	return {
		fontSize: isMobile ? "0.875rem" : "1rem",
		fontWeight: 600,
		margin: "0 0 0.5rem 0",
		color: "#1f2933",
	};
}

function getTopRowStyle(isMobile: boolean): React.CSSProperties {
	return {
		display: "grid",
		gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
		gap: isMobile ? "0.75rem" : "1.5rem",
	};
}

function getStatusGridStyle(isMobile: boolean): React.CSSProperties {
	return {
		display: "grid",
		gridTemplateColumns: isMobile ? "1fr" : "repeat(2, 1fr)",
		gap: "0.5rem",
	};
}

function getPlaceholderBoxStyle(isMobile: boolean): React.CSSProperties {
	return {
		background: "#fffdf8",
		border: "1px dashed #d6cfc2",
		borderRadius: "0.5rem",
		padding: isMobile ? "1.5rem" : "3rem",
		textAlign: "center",
		maxWidth: "30rem",
	};
}

const tabTagStyle: React.CSSProperties = {
	fontSize: "0.625rem",
	padding: "0.125rem 0.25rem",
	background: "#f3f4f6",
	color: "#6b7280",
	borderRadius: "0.25rem",
};

const messagesAreaStyle: React.CSSProperties = {
	flex: 1,
	overflow: "auto",
	padding: "0.5rem",
};
const messagesEmptyStyle: React.CSSProperties = {
	height: "100%",
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "center",
};
const messagesEmptyTextStyle: React.CSSProperties = {
	fontSize: "1rem",
	color: "#6b7280",
	marginBottom: "0.25rem",
};
const messagesEmptyHintStyle: React.CSSProperties = {
	fontSize: "0.875rem",
	color: "#9ca3af",
};

const detailTabStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "1rem",
};
const statusItemStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "0.25rem",
};
const statusLabelStyle: React.CSSProperties = {
	fontSize: "0.75rem",
	color: "#6b7280",
};
const statusValueStyle: React.CSSProperties = {
	fontSize: "0.875rem",
	color: "#1f2933",
};
const activeTextStyle: React.CSSProperties = {
	fontSize: "0.875rem",
	color: "#10b981",
};
const inactiveTextStyle: React.CSSProperties = {
	fontSize: "0.875rem",
	color: "#9ca3af",
};
const placeholderSectionStyle: React.CSSProperties = {
	padding: "1rem",
	background: "#f9fafb",
	borderRadius: "0.375rem",
	border: "1px dashed #d1d5db",
	textAlign: "center",
};
const placeholderTextStyle: React.CSSProperties = {
	display: "block",
	fontSize: "0.875rem",
	color: "#6b7280",
	marginBottom: "0.25rem",
};
const placeholderHintStyle: React.CSSProperties = {
	display: "block",
	fontSize: "0.75rem",
	color: "#9ca3af",
};
const eventListStyle: React.CSSProperties = {
	listStyle: "none",
	margin: 0,
	padding: 0,
	display: "flex",
	flexDirection: "column",
	gap: "0.5rem",
};
const eventItemStyle: React.CSSProperties = {
	padding: "0.75rem",
	background: "#f9fafb",
	borderRadius: "0.375rem",
	border: "1px solid #e5e7eb",
};
const eventHeaderStyle: React.CSSProperties = {
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	marginBottom: "0.25rem",
};
const eventTypeStyle: React.CSSProperties = {
	fontSize: "0.75rem",
	fontWeight: 500,
	color: "#7c5e3c",
};
const eventTimeStyle: React.CSSProperties = {
	fontSize: "0.75rem",
	color: "#9ca3af",
};
const eventDescStyle: React.CSSProperties = {
	fontSize: "0.875rem",
	color: "#4b5563",
	margin: 0,
	lineHeight: 1.5,
};
const emptyEventsStyle: React.CSSProperties = {
	padding: "1.5rem",
	textAlign: "center",
};
const emptyEventsTextStyle: React.CSSProperties = {
	color: "#9ca3af",
	fontSize: "0.875rem",
};

const placeholderContentStyle: React.CSSProperties = {
	display: "flex",
	justifyContent: "center",
	alignItems: "center",
	minHeight: "20rem",
};
const placeholderTitleStyle: React.CSSProperties = {
	fontSize: "1rem",
	fontWeight: 600,
	color: "#1f2933",
	margin: "0 0 0.75rem 0",
};

const textStyle: React.CSSProperties = {
	color: "#6b7280",
	textAlign: "center",
	padding: "2rem",
};
const errorStyle: React.CSSProperties = {
	color: "#dc2626",
	textAlign: "center",
	padding: "2rem",
};

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

function getPreviewItemStyle(role: string): React.CSSProperties {
	const isUser = role === "user";
	return {
		padding: "0.75rem 1rem",
		borderRadius: "0.5rem",
		background: isUser ? "#eff6ff" : "#f9fafb",
		marginBottom: "0.5rem",
		maxWidth: "85%",
		alignSelf: isUser ? "flex-end" : "flex-start",
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
};

const previewTextStyle: React.CSSProperties = {
	fontSize: "0.875rem",
	color: "#1f2933",
	margin: 0,
	lineHeight: 1.5,
	whiteSpace: "pre-wrap",
	wordBreak: "break-word",
};
