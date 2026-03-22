import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import {
	Background,
	Controls,
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
import { buildCanonicalSessionPath } from "./SessionPage";

type TopologyNodeData = {
	label: string;
	type: "instance" | "agent" | "skill" | "external_acp";
	status?: string;
	instanceId?: string;
	agentId?: string;
	drilldownPath?: string;
	isActive?: boolean;
};

const NODE_WIDTH = 220;
const NODE_HEIGHT = 80;

function getLayoutedElements(
	nodes: Node<TopologyNodeData>[],
	edges: Edge[],
	direction: "TB" | "LR" = "TB",
): { nodes: Node<TopologyNodeData>[]; edges: Edge[] } {
	const dagreGraph = new dagre.graphlib.Graph();
	dagreGraph.setDefaultEdgeLabel(() => ({}));
	dagreGraph.setGraph({ rankdir: direction, nodesep: 120, ranksep: 80 });

	nodes.forEach((node) => {
		dagreGraph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
	});

	edges.forEach((edge) => {
		dagreGraph.setEdge(edge.source, edge.target);
	});

	dagre.layout(dagreGraph);

	const layoutedNodes = nodes.map((node) => {
		const nodeWithPosition = dagreGraph.node(node.id);
		return {
			...node,
			position: {
				x: nodeWithPosition.x - NODE_WIDTH / 2,
				y: nodeWithPosition.y - NODE_HEIGHT / 2,
			},
		};
	});

	return { nodes: layoutedNodes, edges };
}

function InstanceNode({ data }: { data: TopologyNodeData }): JSX.Element {
	const isActive = data.status === "active";
	return (
		<div
			style={getInstanceNodeStyle(isActive)}
			data-testid={`topology-node-instance-${data.instanceId}`}
		>
			<Handle type="target" position={Position.Top} style={handleStyle} />
			<div style={nodeHeaderStyle}>
				<span style={nodeTypeLabelStyle}>INSTANCE</span>
				<span style={nodeStatusBadgeStyle(isActive)}>
					{isActive ? "活跃" : "未活跃"}
				</span>
			</div>
			<div style={nodeTitleStyle}>{data.label}</div>
			<Handle type="source" position={Position.Bottom} style={handleStyle} />
		</div>
	);
}

function AgentNode({ data }: { data: TopologyNodeData }): JSX.Element {
	const isHealthy = data.status !== "error";
	return (
		<div
			style={getAgentNodeStyle(isHealthy)}
			data-testid={`topology-node-agent-${data.agentId}`}
		>
			<Handle type="target" position={Position.Top} style={handleStyle} />
			<div style={nodeHeaderStyle}>
				<span style={nodeTypeLabelStyle}>AGENT</span>
				<span style={nodeStatusBadgeStyle(isHealthy)}>
					{getAgentStatusLabel(data.status, data.isActive)}
				</span>
			</div>
			<div style={nodeTitleStyle}>{data.label}</div>
			{data.drilldownPath ? (
				<Link
					to={data.drilldownPath}
					style={drilldownLinkStyle}
					data-testid={`drilldown-link-${data.agentId}`}
				>
					进入会话
				</Link>
			) : null}
			<Handle type="source" position={Position.Bottom} style={handleStyle} />
		</div>
	);
}

function SkillNode({ data }: { data: TopologyNodeData }): JSX.Element {
	return (
		<div
			style={skillNodeStyle}
			data-testid={`topology-node-skill-${data.label}`}
		>
			<Handle type="target" position={Position.Top} style={handleStyle} />
			<div style={nodeHeaderStyle}>
				<span style={nodeTypeLabelStyle}>SKILL</span>
			</div>
			<div style={nodeTitleStyle}>{data.label}</div>
			<Handle type="source" position={Position.Bottom} style={handleStyle} />
		</div>
	);
}

function ExternalAcpNode({ data }: { data: TopologyNodeData }): JSX.Element {
	return (
		<div
			style={externalAcpNodeStyle}
			data-testid={`topology-node-acp-${data.label}`}
		>
			<Handle type="target" position={Position.Top} style={handleStyle} />
			<div style={nodeHeaderStyle}>
				<span style={nodeTypeLabelStyle}>ACP</span>
			</div>
			<div style={nodeTitleStyle}>{data.label}</div>
			<Handle type="source" position={Position.Bottom} style={handleStyle} />
		</div>
	);
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
	skill: SkillNode,
	external_acp: ExternalAcpNode,
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
				data: {
					label: instance.name,
					type: "instance",
					status: instance.status,
					instanceId: instance.instance_id,
				},
			});
		}

		for (const agent of topology.agents) {
			newNodes.push({
				id: agent.node_id,
				type: "agent",
				position: { x: 0, y: 0 },
				data: {
					label: agent.agent_name,
					type: "agent",
					status: agent.status,
					instanceId: agent.instance_id,
					agentId: agent.agent_id,
					drilldownPath: buildCanonicalSessionPath(
						agent.instance_id,
						agent.agent_id,
					),
					isActive: agent.is_active,
				},
			});
		}

		for (const edge of topology.edges) {
			newEdges.push({
				id: `edge-${edge.source}-${edge.target}`,
				source: edge.source,
				target: edge.target,
				style: { stroke: "#c9984c" },
			});
		}

		for (const skill of topology.skills) {
			const nodeId = skill.node_id ?? skill.id ?? `skill-${newNodes.length}`;
			newNodes.push({
				id: nodeId,
				type: "skill",
				position: { x: 0, y: 0 },
				data: {
					label: skill.name ?? skill.label ?? skill.id ?? "Skill",
					type: "skill",
				},
			});
		}

		for (const acp of topology.external_acps) {
			const nodeId = acp.node_id ?? acp.id ?? `acp-${newNodes.length}`;
			newNodes.push({
				id: nodeId,
				type: "external_acp",
				position: { x: 0, y: 0 },
				data: {
					label: acp.name ?? acp.label ?? acp.id ?? "ACP",
					type: "external_acp",
				},
			});
		}

		const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
			newNodes,
			newEdges,
		);

		return { convertedNodes: layoutedNodes, convertedEdges: layoutedEdges };
	}, [topology]);

	useEffect(() => {
		if (convertedNodes.length > 0) {
			setNodes(convertedNodes);
			setEdges(convertedEdges);
		}
	}, [convertedNodes, convertedEdges, setNodes, setEdges]);

	const handleFitView = useCallback(() => {
		fitView({ padding: 0.2 });
	}, [fitView]);

	const handleReset = useCallback(() => {
		void loadTopology();
	}, [loadTopology]);

	if (loading) {
		return (
			<div style={loadingContainerStyle}>
				<p style={loadingTextStyle}>加载拓扑数据...</p>
			</div>
		);
	}

	if (error) {
		const envelope = error instanceof ApiError ? error.envelope : null;
		return (
			<div style={errorContainerStyle}>
				<div style={errorPanelStyle}>
					<p style={errorTextStyle}>错误: {error.message}</p>
					{envelope ? <EnvelopeErrorSummary envelope={envelope} /> : null}
					<button type="button" style={retryButtonStyle} onClick={handleReset}>
						重试
					</button>
				</div>
			</div>
		);
	}

	return (
		<div style={canvasContainerStyle} data-testid="topology-graph-canvas">
			<div style={canvasHeaderStyle}>
				<h1 style={canvasTitleStyle}>拓扑关系图</h1>
				<div style={canvasControlsStyle}>
					<button
						type="button"
						style={controlButtonStyle}
						onClick={handleFitView}
						aria-label="适配画布"
					>
						适配
					</button>
					<button
						type="button"
						style={controlButtonStyle}
						onClick={handleReset}
						aria-label="刷新拓扑"
					>
						刷新
					</button>
				</div>
			</div>
			<div style={graphWrapperStyle}>
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
					<Controls showInteractive={false} />
				</ReactFlow>
			</div>
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
	height: "100%",
	display: "flex",
	flexDirection: "column",
	background:
		"radial-gradient(circle at top left, rgba(210, 179, 120, 0.18), transparent 32%), #f4f1ea",
	color: "#1f2933",
	fontFamily:
		'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
};

const canvasHeaderStyle: React.CSSProperties = {
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	padding: "1rem 1.5rem",
	borderBottom: "1px solid #d7d2c8",
	background: "rgba(255, 255, 255, 0.72)",
	flexShrink: 0,
};

const canvasTitleStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "1.25rem",
	fontWeight: 700,
	color: "#1f2933",
};

const canvasControlsStyle: React.CSSProperties = {
	display: "flex",
	gap: "0.5rem",
};

const controlButtonStyle: React.CSSProperties = {
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	padding: "0.4rem 0.8rem",
	borderRadius: "0.5rem",
	fontSize: "0.8rem",
	fontWeight: 600,
	textDecoration: "none",
	border: "1px solid #d7d2c8",
	cursor: "pointer",
	background: "#fff",
	color: "#1f2933",
};

const graphWrapperStyle: React.CSSProperties = {
	flex: 1,
	minHeight: 0,
};

const loadingContainerStyle: React.CSSProperties = {
	height: "100%",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	background:
		"radial-gradient(circle at top left, rgba(210, 179, 120, 0.18), transparent 32%), #f4f1ea",
};

const loadingTextStyle: React.CSSProperties = {
	fontSize: "1rem",
	color: "#6b7280",
};

const errorContainerStyle: React.CSSProperties = {
	height: "100%",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	padding: "2rem",
	background:
		"radial-gradient(circle at top left, rgba(210, 179, 120, 0.18), transparent 32%), #f4f1ea",
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

const nodeHeaderStyle: React.CSSProperties = {
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	marginBottom: "0.25rem",
};

const nodeTypeLabelStyle: React.CSSProperties = {
	fontSize: "0.65rem",
	fontWeight: 700,
	letterSpacing: "0.08em",
	textTransform: "uppercase",
	color: "#6b7280",
};

const nodeStatusBadgeStyle = (isHealthy: boolean): React.CSSProperties => ({
	fontSize: "0.65rem",
	padding: "0.15rem 0.4rem",
	borderRadius: "999px",
	background: isHealthy ? "#ecfdf5" : "#fff7ed",
	color: isHealthy ? "#166534" : "#9a3412",
	fontWeight: 700,
});

const nodeTitleStyle: React.CSSProperties = {
	fontSize: "0.95rem",
	fontWeight: 700,
	color: "#1f2933",
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
};

const drilldownLinkStyle: React.CSSProperties = {
	display: "inline-block",
	marginTop: "0.4rem",
	padding: "0.25rem 0.5rem",
	fontSize: "0.75rem",
	fontWeight: 600,
	color: "#fff",
	background: "#1f2933",
	borderRadius: "0.375rem",
	textDecoration: "none",
};

const baseNodeStyle: React.CSSProperties = {
	padding: "0.75rem 1rem",
	borderRadius: "0.75rem",
	minWidth: NODE_WIDTH,
	minHeight: NODE_HEIGHT,
	boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
	fontFamily:
		'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
};

function getInstanceNodeStyle(isActive: boolean): React.CSSProperties {
	return {
		...baseNodeStyle,
		background: "rgba(255, 255, 255, 0.96)",
		border: `2px solid ${isActive ? "#c9984c" : "#d7d2c8"}`,
	};
}

function getAgentNodeStyle(isHealthy: boolean): React.CSSProperties {
	return {
		...baseNodeStyle,
		background: "rgba(255, 255, 255, 0.96)",
		border: `2px solid ${isHealthy ? "#10b981" : "#f59e0b"}`,
	};
}

const skillNodeStyle: React.CSSProperties = {
	...baseNodeStyle,
	background: "rgba(239, 246, 255, 0.96)",
	border: "2px solid #93c5fd",
};

const externalAcpNodeStyle: React.CSSProperties = {
	...baseNodeStyle,
	background: "rgba(254, 243, 199, 0.96)",
	border: "2px solid #fcd34d",
};
