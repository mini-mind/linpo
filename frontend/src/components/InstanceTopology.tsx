import "@xyflow/react/dist/style.css";
import {
	Background,
	type Edge,
	Handle,
	type Node,
	type NodeTypes,
	Position,
	ReactFlow,
	ReactFlowProvider,
	useEdgesState,
	useNodesState,
	useReactFlow,
} from "@xyflow/react";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, getAggregateTopology } from "../api/client";
import type { AggregateTopologyResponse, ErrorEnvelope } from "../api/types";
import { buildSessionEntryPath } from "./SessionPage";

type TopologyLane = "instance" | "agent" | "session" | "tool";

type TopologyNodeData = {
	label: string;
	type: TopologyLane;
	status?: string;
	instanceId?: string;
	agentId?: string;
	sessionKey?: string;
	toolId?: string;
	drilldownPath?: string;
	isActive?: boolean;
	updatedAt?: string | null;
	parentNodeId?: string;
	action: TopologyNodeAction;
};

type TopologyNodeAction = {
	kind: "enter" | "fallback" | "disabled";
	statusLabel: string;
	detail: string;
	actionLabel?: string;
	href?: string;
};

const TOPOLOGY_LANES: ReadonlyArray<{ key: TopologyLane; label: string }> = [
	{ key: "instance", label: "实例" },
	{ key: "agent", label: "智能体" },
	{ key: "session", label: "会话" },
	{ key: "tool", label: "工具" },
];

const NODE_SIZE = 156;
const LANE_START_X = 80;
const LANE_GAP_X = 260;
const ROW_GAP_Y = 220;
const CHILD_GAP_Y = 180;

function getLayoutedElements(
	nodes: Node<TopologyNodeData>[],
	edges: Edge[],
): { nodes: Node<TopologyNodeData>[]; edges: Edge[] } {
	const laneIndex = new Map(
		TOPOLOGY_LANES.map((lane, index) => [lane.key, index]),
	);
	const laneNextY: Record<TopologyLane, number> = {
		instance: 40,
		agent: 40,
		session: 40,
		tool: 40,
	};
	const parentY = new Map<string, number>();
	const childIndexByLaneParent = new Map<string, number>();

	const sortedNodes = [...nodes].sort((left, right) => {
		const laneDelta =
			(laneIndex.get(left.data.type) ?? 0) -
			(laneIndex.get(right.data.type) ?? 0);
		if (laneDelta !== 0) return laneDelta;
		const parentDelta = (left.data.parentNodeId ?? "").localeCompare(
			right.data.parentNodeId ?? "",
		);
		if (parentDelta !== 0) return parentDelta;
		return left.data.label.localeCompare(right.data.label);
	});

	const layoutedNodes = sortedNodes.map((node) => {
		const x = LANE_START_X + (laneIndex.get(node.data.type) ?? 0) * LANE_GAP_X;
		let y = laneNextY[node.data.type];

		if (node.data.parentNodeId && parentY.has(node.data.parentNodeId)) {
			const laneParentKey = `${node.data.type}:${node.data.parentNodeId}`;
			const childIndex = childIndexByLaneParent.get(laneParentKey) ?? 0;
			const parentAnchorY = parentY.get(node.data.parentNodeId) ?? 40;
			y = Math.max(y, parentAnchorY + childIndex * CHILD_GAP_Y);
			childIndexByLaneParent.set(laneParentKey, childIndex + 1);
		}

		laneNextY[node.data.type] = y + ROW_GAP_Y;
		parentY.set(node.id, y);

		return {
			...node,
			position: { x, y },
		};
	});

	return { nodes: layoutedNodes, edges };
}

function CircleNodeFrame({
	data,
	typeLabel,
	badge,
	accent,
	children,
	testId,
}: {
	data: TopologyNodeData;
	typeLabel: string;
	badge?: string;
	accent: string;
	children?: React.ReactNode;
	testId: string;
}): JSX.Element {
	return (
		<div style={getCircleNodeStyle(accent)} data-testid={testId}>
			<Handle type="target" position={Position.Left} style={handleStyle} />
			<div style={circleTypeLabelStyle}>{typeLabel}</div>
			<div style={circleTitleStyle}>{data.label}</div>
			{badge ? <div style={circleBadgeStyle}>{badge}</div> : null}
			{data.updatedAt ? (
				<div style={circleMetaStyle}>{data.updatedAt}</div>
			) : null}
			<NodeActionAffordance action={data.action} />
			{children}
			<Handle type="source" position={Position.Right} style={handleStyle} />
		</div>
	);
}

function InstanceNode({ data }: { data: TopologyNodeData }): JSX.Element {
	const isActive = data.status === "active";
	return (
		<CircleNodeFrame
			data={data}
			typeLabel="INSTANCE"
			badge={isActive ? "活跃" : "未活跃"}
			accent={isActive ? "#c9984c" : "#d7d2c8"}
			testId={`topology-node-instance-${data.instanceId}`}
		/>
	);
}

function AgentNode({ data }: { data: TopologyNodeData }): JSX.Element {
	const isHealthy = data.status !== "error";
	return (
		<CircleNodeFrame
			data={data}
			typeLabel="AGENT"
			badge={getAgentStatusLabel(data.status, data.isActive)}
			accent={isHealthy ? "#10b981" : "#f59e0b"}
			testId={`topology-node-agent-${data.agentId}`}
		/>
	);
}

function SessionNode({ data }: { data: TopologyNodeData }): JSX.Element {
	return (
		<CircleNodeFrame
			data={data}
			typeLabel="SESSION"
			badge={data.sessionKey ?? "会话"}
			accent="#5b8def"
			testId={`topology-node-session-${data.sessionKey}`}
		/>
	);
}

function ToolNode({ data }: { data: TopologyNodeData }): JSX.Element {
	return (
		<CircleNodeFrame
			data={data}
			typeLabel="TOOL"
			badge={data.toolId ?? "tool"}
			accent="#ef8f4c"
			testId={`topology-node-tool-${data.label}`}
		/>
	);
}

function NodeActionAffordance({
	action,
}: {
	action: TopologyNodeAction;
}): JSX.Element {
	return (
		<div style={nodeActionContainerStyle}>
			<span style={getNodeActionBadgeStyle(action.kind)}>
				{action.statusLabel}
			</span>
			<div style={nodeActionDetailStyle}>{action.detail}</div>
			{action.href && action.actionLabel ? (
				<Link to={action.href} style={nodeActionLinkStyle}>
					{action.actionLabel}
				</Link>
			) : null}
		</div>
	);
}

function buildNodeSessionAction(data: {
	type: TopologyLane;
	instanceId?: string;
	agentId?: string;
	sessionKey?: string;
}): TopologyNodeAction {
	if (data.type === "instance") {
		return {
			kind: "disabled",
			statusLabel: "已禁用",
			detail: "实例节点不提供会话入口",
		};
	}

	if (data.type === "agent") {
		if (data.instanceId && data.agentId) {
			return {
				kind: "enter",
				statusLabel: "可进入",
				detail: "默认会话",
				actionLabel: "进入默认会话",
				href: buildSessionEntryPath({
					instanceId: data.instanceId,
					agentId: data.agentId,
				}),
			};
		}

		return {
			kind: "disabled",
			statusLabel: "已禁用",
			detail: "缺少进入上下文",
		};
	}

	if (data.type === "session") {
		if (data.instanceId && data.agentId && data.sessionKey) {
			return {
				kind: "enter",
				statusLabel: "可进入",
				detail: "精确会话",
				actionLabel: "进入对应会话",
				href: buildSessionEntryPath({
					instanceId: data.instanceId,
					agentId: data.agentId,
					preferredSessionKey: data.sessionKey,
				}),
			};
		}

		return {
			kind: "disabled",
			statusLabel: "已禁用",
			detail: "缺少 session key",
		};
	}

	if (data.instanceId && data.agentId) {
		return {
			kind: "fallback",
			statusLabel: "回退入口",
			detail: "回退到所属智能体",
			actionLabel: "回退到所属智能体",
			href: buildSessionEntryPath({
				instanceId: data.instanceId,
				agentId: data.agentId,
				preferredSessionKey: data.sessionKey,
			}),
		};
	}

	return {
		kind: "disabled",
		statusLabel: "已禁用",
		detail: "缺少可回退上下文",
	};
}

function getAgentStatusLabel(status?: string, isActive?: boolean): string {
	if (status === "running") return "运行中";
	if (status === "finished") return "已完成";
	if (status === "error") return "异常";
	return isActive ? "待命中" : "待巡视";
}

const nodeTypes: NodeTypes = {
	instance: InstanceNode,
	agent: AgentNode,
	session: SessionNode,
	tool: ToolNode,
};

function TopologyCanvas(): JSX.Element {
	const [topology, setTopology] = useState<AggregateTopologyResponse | null>(
		null,
	);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<Error | null>(null);
	const { fitView } = useReactFlow();

	const [nodes, setNodes, onNodesChange] = useNodesState<
		Node<TopologyNodeData>
	>([]);
	const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

	const loadTopology = useCallback(async (): Promise<void> => {
		try {
			setLoading(true);
			setError(null);
			const data = await getAggregateTopology();
			setTopology(data);
		} catch (err) {
			setError(err instanceof Error ? err : new Error("获取聚合拓扑失败"));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadTopology();
	}, [loadTopology]);

	const { convertedNodes, convertedEdges } = useMemo(() => {
		if (!topology) {
			return { convertedNodes: [], convertedEdges: [] };
		}

		const newNodes: Node<TopologyNodeData>[] = [];
		const newEdges: Edge[] = [];

		for (const instance of topology.instances) {
			newNodes.push({
				id: instance.node_id,
				type: "instance",
				position: { x: 0, y: 0 },
				initialWidth: NODE_SIZE,
				initialHeight: NODE_SIZE,
				data: {
					label: instance.name,
					type: "instance",
					status: instance.status,
					instanceId: instance.instance_id,
					action: buildNodeSessionAction({
						type: "instance",
						instanceId: instance.instance_id,
					}),
				},
			});
		}

		for (const agent of topology.agents) {
			newNodes.push({
				id: agent.node_id,
				type: "agent",
				position: { x: 0, y: 0 },
				initialWidth: NODE_SIZE,
				initialHeight: NODE_SIZE,
				data: {
					label: agent.agent_name,
					type: "agent",
					status: agent.status,
					instanceId: agent.instance_id,
					agentId: agent.agent_id,
					isActive: agent.is_active,
					parentNodeId: `instance:${agent.instance_id}`,
					action: buildNodeSessionAction({
						type: "agent",
						instanceId: agent.instance_id,
						agentId: agent.agent_id,
					}),
				},
			});
		}

		for (const session of topology.sessions) {
			newNodes.push({
				id: session.node_id,
				type: "session",
				position: { x: 0, y: 0 },
				initialWidth: NODE_SIZE,
				initialHeight: NODE_SIZE,
				data: {
					label: session.label,
					type: "session",
					instanceId: session.instance_id,
					agentId: session.agent_id,
					sessionKey: session.session_key,
					updatedAt: session.updated_at,
					parentNodeId: `agent:${session.instance_id}:${session.agent_id}`,
					action: buildNodeSessionAction({
						type: "session",
						instanceId: session.instance_id,
						agentId: session.agent_id,
						sessionKey: session.session_key,
					}),
				},
			});
		}

		for (const tool of topology.tools) {
			newNodes.push({
				id: tool.node_id,
				type: "tool",
				position: { x: 0, y: 0 },
				initialWidth: NODE_SIZE,
				initialHeight: NODE_SIZE,
				data: {
					label: tool.name,
					type: "tool",
					instanceId: tool.instance_id,
					agentId: tool.agent_id,
					toolId: tool.tool_id,
					parentNodeId: `agent:${tool.instance_id}:${tool.agent_id}`,
					action: buildNodeSessionAction({
						type: "tool",
						instanceId: tool.instance_id,
						agentId: tool.agent_id,
					}),
				},
			});
		}

		for (const edge of topology.edges) {
			newEdges.push({
				id: `edge-${edge.source}-${edge.target}`,
				source: edge.source,
				target: edge.target,
				style: { stroke: "#c9984c", strokeWidth: 1.6 },
				animated: edge.kind !== "instance_agent",
			});
		}

		const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
			newNodes,
			newEdges,
		);
		return { convertedNodes: layoutedNodes, convertedEdges: layoutedEdges };
	}, [topology]);

	useEffect(() => {
		setNodes(convertedNodes);
		setEdges(convertedEdges);
	}, [convertedNodes, convertedEdges, setNodes, setEdges]);

	const handleReset = useCallback(() => {
		void loadTopology();
	}, [loadTopology]);

	const envelope = error instanceof ApiError ? error.envelope : null;
	const unauthorized = envelope?.code === "unauthorized";
	const isEmptyTopology = Boolean(
		topology && convertedNodes.length === 0 && convertedEdges.length === 0,
	);

	return (
		<div style={canvasContainerStyle} data-testid="topology-graph-canvas">
			<div style={canvasControlsOverlayStyle}>
				<button
					type="button"
					style={controlButtonStyle}
					onClick={() => fitView({ padding: 0.2 })}
					aria-label="适配画布"
				>
					适配
				</button>
				<button
					type="button"
					style={controlButtonStyle}
					onClick={handleReset}
					aria-label="刷新"
				>
					刷新
				</button>
			</div>
			{loading ? (
				<div style={stateContainerStyle}>
					<div style={emptyPanelStyle}>
						<p style={stateTitleStyle}>加载拓扑数据...</p>
						<p style={stateDetailStyle}>
							正在通过 getAggregateTopology 同步当前路由关系。
						</p>
					</div>
				</div>
			) : error ? (
				<div style={stateContainerStyle}>
					<div style={errorPanelStyle}>
						<h2 style={errorTitleStyle}>
							{unauthorized ? "当前无权查看拓扑" : "拓扑暂时不可用"}
						</h2>
						<p style={errorTextStyle}>错误: {error.message}</p>
						{envelope ? <EnvelopeErrorSummary envelope={envelope} /> : null}
						<button
							type="button"
							style={retryButtonStyle}
							onClick={handleReset}
						>
							重试
						</button>
					</div>
				</div>
			) : isEmptyTopology ? (
				<div style={stateContainerStyle}>
					<div style={emptyPanelStyle}>
						<p style={stateTitleStyle}>当前没有可展示的拓扑关系</p>
						<p style={stateDetailStyle}>
							聚合读取成功，但暂未返回实例、智能体、会话或工具节点。
						</p>
					</div>
				</div>
			) : (
				<ReactFlow
					nodes={nodes}
					edges={edges}
					onNodesChange={onNodesChange}
					onEdgesChange={onEdgesChange}
					nodeTypes={nodeTypes}
					nodesDraggable={false}
					nodesConnectable={false}
					elementsSelectable={false}
					fitView
					fitViewOptions={{ padding: 0.2 }}
					minZoom={0.1}
					maxZoom={2}
					attributionPosition="bottom-left"
				>
					<Background color="#d7d2c8" gap={24} />
				</ReactFlow>
			)}
		</div>
	);
}

export function InstanceTopology(): JSX.Element {
	return (
		<ReactFlowProvider>
			<TopologyCanvas />
		</ReactFlowProvider>
	);
}

function EnvelopeErrorSummary({
	envelope,
}: {
	envelope: ErrorEnvelope;
}): JSX.Element {
	return (
		<div style={errorMetaListStyle}>
			<p style={errorMetaStyle}>code · {envelope.code}</p>
			<p style={errorMetaStyle}>request_id · {envelope.request_id}</p>
			<p style={errorMetaStyle}>recoverable · {String(envelope.recoverable)}</p>
			{envelope.next_step ? (
				<p style={errorHintStyle}>{envelope.next_step}</p>
			) : null}
		</div>
	);
}

const canvasContainerStyle: React.CSSProperties = {
	width: "100%",
	height: "100%",
	minHeight: "100dvh",
	display: "flex",
	flexDirection: "column",
	position: "relative",
	overflow: "hidden",
	background: "#f4f1ea",
	color: "#1f2933",
	fontFamily:
		'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
};

const canvasControlsOverlayStyle: React.CSSProperties = {
	position: "absolute",
	top: "1rem",
	right: "1rem",
	display: "flex",
	gap: "0.5rem",
	zIndex: 10,
};

const controlButtonStyle: React.CSSProperties = {
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	padding: "0.48rem 0.9rem",
	borderRadius: "0.5rem",
	fontSize: "0.8rem",
	fontWeight: 600,
	textDecoration: "none",
	border: "1px solid rgba(201, 152, 76, 0.28)",
	cursor: "pointer",
	background: "rgba(255, 255, 255, 0.9)",
	color: "#1f2933",
	boxShadow: "0 6px 14px rgba(31, 41, 51, 0.06)",
};

const stateContainerStyle: React.CSSProperties = {
	height: "100%",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	padding: "2rem",
	background:
		"radial-gradient(circle at top left, rgba(210, 179, 120, 0.12), transparent 28%), rgba(255, 255, 255, 0.52)",
};

const emptyPanelStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	gap: "0.5rem",
	padding: "2rem",
	maxWidth: "30rem",
	textAlign: "center",
	background: "rgba(255, 255, 255, 0.92)",
	border: "1px solid rgba(215, 210, 200, 0.92)",
	borderRadius: "1rem",
	boxShadow: "0 10px 24px rgba(31, 41, 51, 0.08)",
};

const stateTitleStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "1rem",
	fontWeight: 700,
	color: "#1f2933",
};

const stateDetailStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.85rem",
	lineHeight: 1.6,
	color: "#6b7280",
	textAlign: "center",
};

const errorPanelStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	gap: "1rem",
	padding: "2rem",
	background: "rgba(255, 255, 255, 0.92)",
	border: "1px solid #d7d2c8",
	borderRadius: "1rem",
	maxWidth: "400px",
};

const errorTitleStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "1.1rem",
	fontWeight: 700,
	color: "#1f2933",
	textAlign: "center",
};

const errorTextStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "1rem",
	color: "#dc2626",
	textAlign: "center",
};

const retryButtonStyle: React.CSSProperties = {
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	padding: "0.5rem 1rem",
	borderRadius: "0.5rem",
	fontSize: "0.9rem",
	fontWeight: 600,
	border: "1px solid #c9984c",
	cursor: "pointer",
	background: "#c9984c",
	color: "#fff",
};

const errorMetaListStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "0.25rem",
	alignItems: "center",
};

const errorMetaStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.75rem",
	color: "#6b7280",
	fontFamily:
		'ui-monospace, SFMono-Regular, "SFMono-Regular", Consolas, monospace',
};

const errorHintStyle: React.CSSProperties = {
	margin: "0.5rem 0 0 0",
	fontSize: "0.8125rem",
	color: "#6b7280",
	textAlign: "center",
};

const handleStyle: React.CSSProperties = {
	width: 8,
	height: 8,
	background: "#c9984c",
	border: "2px solid #fff",
};

const circleTypeLabelStyle: React.CSSProperties = {
	fontSize: "0.64rem",
	fontWeight: 700,
	letterSpacing: "0.12em",
	textTransform: "uppercase",
	color: "#6b7280",
	textAlign: "center",
};

const circleTitleStyle: React.CSSProperties = {
	fontSize: "0.92rem",
	fontWeight: 700,
	lineHeight: 1.35,
	color: "#1f2933",
	textAlign: "center",
	wordBreak: "break-word",
	display: "-webkit-box",
	WebkitLineClamp: 3,
	WebkitBoxOrient: "vertical",
	overflow: "hidden",
};

const circleBadgeStyle: React.CSSProperties = {
	fontSize: "0.68rem",
	lineHeight: 1.3,
	padding: "0.18rem 0.45rem",
	borderRadius: "999px",
	background: "rgba(255, 255, 255, 0.92)",
	color: "#6b4d1f",
	maxWidth: "100%",
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
};

const circleMetaStyle: React.CSSProperties = {
	fontSize: "0.64rem",
	lineHeight: 1.25,
	color: "#7a8895",
	textAlign: "center",
};

const nodeActionContainerStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	gap: "0.18rem",
	maxWidth: "100%",
};

const nodeActionDetailStyle: React.CSSProperties = {
	fontSize: "0.62rem",
	lineHeight: 1.3,
	color: "#52606d",
	textAlign: "center",
};

const nodeActionLinkStyle: React.CSSProperties = {
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	padding: "0.16rem 0.45rem",
	fontSize: "0.62rem",
	fontWeight: 700,
	color: "#fff",
	background: "#1f2933",
	borderRadius: "999px",
	textDecoration: "none",
};

function getNodeActionBadgeStyle(
	kind: TopologyNodeAction["kind"],
): React.CSSProperties {
	const palette =
		kind === "enter"
			? {
					background: "rgba(16, 185, 129, 0.14)",
					color: "#0f766e",
				}
			: kind === "fallback"
				? {
						background: "rgba(245, 158, 11, 0.16)",
						color: "#9a6c29",
					}
				: {
						background: "rgba(148, 163, 184, 0.16)",
						color: "#64748b",
					};

	return {
		display: "inline-flex",
		alignItems: "center",
		justifyContent: "center",
		padding: "0.12rem 0.42rem",
		borderRadius: "999px",
		fontSize: "0.58rem",
		fontWeight: 700,
		letterSpacing: "0.04em",
		background: palette.background,
		color: palette.color,
	};
}

function getCircleNodeStyle(accent: string): React.CSSProperties {
	return {
		width: `${NODE_SIZE}px`,
		height: `${NODE_SIZE}px`,
		borderRadius: "999px",
		padding: "1rem 0.95rem",
		display: "flex",
		flexDirection: "column",
		alignItems: "center",
		justifyContent: "center",
		gap: "0.38rem",
		textAlign: "center",
		background:
			"radial-gradient(circle at top, rgba(255, 255, 255, 0.98) 0%, rgba(246, 241, 232, 0.96) 100%)",
		border: `2px solid ${accent}`,
		boxShadow: "0 10px 24px rgba(31, 41, 51, 0.12)",
		fontFamily:
			'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
	};
}
