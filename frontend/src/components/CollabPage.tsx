import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, getAggregateOverview } from "../api/client";
import type {
	AggregateInstanceDiagnostic,
	AggregateOverviewAgentItem,
	AggregateOverviewResponse,
	ErrorEnvelope,
} from "../api/types";
import { useIsMobile } from "../hooks/useIsMobile";

type KanbanColumn = "needs_attention" | "in_progress" | "pending_review" | "completed";

type ColumnConfig = {
	key: KanbanColumn;
	title: string;
	dotColor: string;
	badgeBg: string;
	badgeText: string;
};

const COLUMNS: ColumnConfig[] = [
	{
		key: "needs_attention",
		title: "需关注",
		dotColor: "#dc2626",
		badgeBg: "#fee2e2",
		badgeText: "#991b1b",
	},
	{
		key: "in_progress",
		title: "进行中",
		dotColor: "#7c3aed",
		badgeBg: "#ede9fe",
		badgeText: "#5b21b6",
	},
	{
		key: "pending_review",
		title: "待巡视",
		dotColor: "#f59e0b",
		badgeBg: "#fef3c7",
		badgeText: "#92400e",
	},
	{
		key: "completed",
		title: "已完成",
		dotColor: "#10b981",
		badgeBg: "#d1fae5",
		badgeText: "#065f46",
	},
];

function getAgentColumn(agent: AggregateOverviewAgentItem, hasFailedInstance: boolean): KanbanColumn {
	if (hasFailedInstance) return "needs_attention";
	if (agent.status === "error") return "needs_attention";
	if (agent.status === "finished") return "completed";
	if (agent.status === "running" && agent.is_active) return "in_progress";
	return "pending_review";
}

export default function CollabPage(): JSX.Element {
	const isMobile = useIsMobile();
	const [overview, setOverview] = useState<AggregateOverviewResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<Error | null>(null);

	const loadKanban = useCallback(async () => {
		try {
			setLoading(true);
			setError(null);
			const data = await getAggregateOverview();
			setOverview(data);
		} catch (nextError) {
			setError(
				nextError instanceof Error ? nextError : new Error("获取看板聚合失败"),
			);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadKanban();
	}, [loadKanban]);

	const failedInstanceIds = useMemo(() => {
		const diagnostics = overview?.diagnostics ?? [];
		return new Set(
			diagnostics
				.filter((d) => d.status === "failed" || d.error)
				.map((d) => d.instance_id),
		);
	}, [overview?.diagnostics]);

	const agentsByColumn = useMemo(() => {
		const agents = overview?.agents ?? [];
		const grouped: Record<KanbanColumn, AggregateOverviewAgentItem[]> = {
			needs_attention: [],
			in_progress: [],
			pending_review: [],
			completed: [],
		};
		for (const agent of agents) {
			const column = getAgentColumn(agent, failedInstanceIds.has(agent.instance_id));
			grouped[column].push(agent);
		}
		return grouped;
	}, [overview?.agents, failedInstanceIds]);

	const getDiagnosticForInstance = useCallback(
		(instanceId: string): AggregateInstanceDiagnostic | undefined => {
			return overview?.diagnostics?.find((d) => d.instance_id === instanceId);
		},
		[overview?.diagnostics],
	);

	if (loading) {
		return (
			<section aria-label="kanban-page" style={getContainerStyle(isMobile)}>
				<div style={loadingStyle}>加载中...</div>
			</section>
		);
	}

	if (error) {
		const envelope = error instanceof ApiError ? error.envelope : null;
		return (
			<section aria-label="kanban-page" style={getContainerStyle(isMobile)}>
				<div style={errorPanelStyle}>
					<p style={errorTitleStyle}>加载失败</p>
					<p style={errorMessageStyle}>{error.message}</p>
					{envelope ? <EnvelopeErrorDetails envelope={envelope} /> : null}
					<button
						type="button"
						onClick={loadKanban}
						style={retryButtonStyle}
					>
						重试
					</button>
				</div>
			</section>
		);
	}

	const agents = overview?.agents ?? [];
	const totalCards = agents.length;

	return (
		<section aria-label="kanban-page" style={getContainerStyle(isMobile)}>
			<header style={headerStyle}>
				<h1 style={titleStyle}>看板</h1>
				<p style={subtitleStyle}>
					聚合工作项、协作状态与关键工作信号 · {totalCards} 项
				</p>
			</header>

			{overview && (
				<div style={getSummaryStripStyle(isMobile)}>
					<div style={summaryItemStyle}>
						<span style={summaryLabelStyle}>聚合状态</span>
						<span style={getFreshnessStyle(overview.freshness.status)}>
							{overview.freshness.status}
						</span>
					</div>
					{overview.partial_failure && (
						<div style={summaryItemStyle}>
							<span style={summaryLabelStyle}>诊断</span>
							<span style={degradedStyle}>部分降级</span>
						</div>
					)}
				</div>
			)}

			{agents.length === 0 ? (
				<EmptyKanbanState />
			) : (
				<div
					data-testid="kanban-board"
					style={getBoardStyle(isMobile)}
				>
					{COLUMNS.map((column) => {
						const columnAgents = agentsByColumn[column.key];
						return (
							<div key={column.key} data-column-key={column.key} style={getColumnStyle(isMobile)}>
								<div style={getColumnHeaderStyle(column.dotColor)}>
									<div style={columnTitleRowStyle}>
										<span
											style={getDotStyle(column.dotColor)}
											aria-hidden="true"
										/>
										<h2 style={columnTitleStyle}>{column.title}</h2>
									</div>
									<span
										style={getBadgeStyle(column.badgeBg, column.badgeText)}
									>
										{columnAgents.length}
									</span>
								</div>
								<div style={columnBodyStyle}>
									{columnAgents.length === 0 ? (
										<div style={emptyColumnStyle}>暂无</div>
									) : (
										columnAgents.map((agent) => (
											<KanbanCard
												key={`${agent.instance_id}:${agent.agent_id}`}
												agent={agent}
												diagnostic={getDiagnosticForInstance(agent.instance_id)}
												hasFailedInstance={failedInstanceIds.has(agent.instance_id)}
											/>
										))
									)}
								</div>
							</div>
						);
					})}
				</div>
			)}
		</section>
	);
}

function EnvelopeErrorDetails({ envelope }: { envelope: ErrorEnvelope }): JSX.Element {
	return (
		<div style={errorMetaStyle}>
			<p style={metaTextStyle}>code · {envelope.code}</p>
			<p style={metaTextStyle}>request_id · {envelope.request_id}</p>
			<p style={metaTextStyle}>recoverable · {String(envelope.recoverable)}</p>
			{envelope.next_step && (
				<p style={hintTextStyle}>{envelope.next_step}</p>
			)}
		</div>
	);
}

function EmptyKanbanState(): JSX.Element {
	return (
		<div style={emptyStateStyle}>
			<p style={emptyTitleStyle}>当前没有可观察的工作信号</p>
			<p style={emptyHintStyle}>
				前往拓扑页确认实例与 agent 配置，或等待实例上报活跃数据。
			</p>
			<Link to="/topology" style={emptyLinkStyle}>
				查看拓扑
			</Link>
		</div>
	);
}

interface KanbanCardProps {
	agent: AggregateOverviewAgentItem;
	diagnostic?: AggregateInstanceDiagnostic;
	hasFailedInstance: boolean;
}

function KanbanCard({ agent, diagnostic, hasFailedInstance }: KanbanCardProps): JSX.Element {
	const statusLabel = getStatusLabel(agent.status, agent.is_active);
	const statusTone = getStatusTone(agent.status, agent.is_active);

	return (
		<article style={getCardStyle(hasFailedInstance)}>
			<div style={cardHeaderStyle}>
				<div style={cardTitleBlockStyle}>
					<span style={cardAgentNameStyle}>{agent.agent_name}</span>
					<span style={cardInstanceStyle}>{agent.instance_name}</span>
				</div>
				<span style={getStatusBadgeStyle(statusTone)}>{statusLabel}</span>
			</div>
			<p style={cardBodyStyle}>{getAgentSummary(agent)}</p>
			<div style={cardMetaStyle}>
				{agent.last_active_at ? (
					<span style={metaLabelStyle}>最近活动 · {agent.last_active_at}</span>
				) : (
					<span style={metaLabelStyle}>最近活动暂未上报</span>
				)}
			</div>
			{diagnostic?.error && (
				<div style={diagnosticAlertStyle}>
					<span style={diagnosticAlertTextStyle}>
						{diagnostic.error.message}
					</span>
				</div>
			)}
			<Link
				to={agent.drilldown_path}
				style={drillDownLinkStyle}
				aria-label={`进入会话 - ${agent.agent_name}`}
			>
				进入会话
			</Link>
		</article>
	);
}

function getStatusLabel(status: string, isActive: boolean): string {
	if (status === "error") return "异常";
	if (status === "running") return "运行中";
	if (status === "finished") return "已完成";
	return isActive ? "待命中" : "待巡视";
}

function getStatusTone(status: string, isActive: boolean): "error" | "active" | "idle" | "done" {
	if (status === "error") return "error";
	if (status === "running" && isActive) return "active";
	if (status === "finished") return "done";
	return "idle";
}

function getAgentSummary(agent: AggregateOverviewAgentItem): string {
	if (agent.status === "error") return "存在待处理异常，建议立即接管。";
	if (agent.status === "running") return "工作流正在推进，可直接进入会话跟进。";
	if (agent.status === "finished") return "最近一次工作已完成，可复盘上下文。";
	return agent.is_active ? "保持待命，可随时进入会话接管。" : "当前信号较弱，建议纳入 follow-up。";
}

function getContainerStyle(isMobile: boolean): React.CSSProperties {
	return {
		height: "100%",
		padding: isMobile ? "0.75rem" : "1.5rem",
		background: "#f8f7f4",
		color: "#1f2933",
		fontFamily:
			'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
		overflow: "auto",
		boxSizing: "border-box",
		display: "flex",
		flexDirection: "column",
	};
}

const headerStyle: React.CSSProperties = {
	marginBottom: "1rem",
};

const titleStyle: React.CSSProperties = {
	fontSize: "1.375rem",
	fontWeight: 700,
	color: "#1f2933",
	margin: "0 0 0.25rem 0",
};

const subtitleStyle: React.CSSProperties = {
	fontSize: "0.8125rem",
	color: "#6b7280",
	margin: 0,
};

const loadingStyle: React.CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	flex: 1,
	fontSize: "0.9375rem",
	color: "#6b7280",
};

const errorPanelStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	gap: "0.75rem",
	padding: "2rem",
	flex: 1,
	justifyContent: "center",
};

const errorTitleStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "1.125rem",
	fontWeight: 700,
	color: "#b91c1c",
};

const errorMessageStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.875rem",
	color: "#6b7280",
	textAlign: "center",
};

const errorMetaStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "0.25rem",
	alignItems: "center",
};

const metaTextStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.75rem",
	color: "#6b7280",
	fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
};

const hintTextStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.8125rem",
	color: "#6b7280",
	textAlign: "center",
};

const retryButtonStyle: React.CSSProperties = {
	padding: "0.5rem 1rem",
	borderRadius: "0.5rem",
	border: "1px solid #e5e7eb",
	background: "#fff",
	color: "#374151",
	fontSize: "0.875rem",
	fontWeight: 600,
	cursor: "pointer",
};

function getSummaryStripStyle(isMobile: boolean): React.CSSProperties {
	return {
		display: "flex",
		gap: "1rem",
		marginBottom: "1rem",
		padding: isMobile ? "0.5rem 0.75rem" : "0.5rem 1rem",
		background: "#fff",
		borderRadius: "0.5rem",
		border: "1px solid #e5e7eb",
		fontSize: "0.75rem",
	};
}

const summaryItemStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "0.125rem",
};

const summaryLabelStyle: React.CSSProperties = {
	fontSize: "0.6875rem",
	color: "#9ca3af",
	textTransform: "uppercase",
	letterSpacing: "0.05em",
};

function getFreshnessStyle(status: string): React.CSSProperties {
	const color = status === "fresh" ? "#166534" : status === "stale" ? "#b45309" : "#b91c1c";
	return {
		fontSize: "0.8125rem",
		fontWeight: 600,
		color,
	};
}

const degradedStyle: React.CSSProperties = {
	fontSize: "0.8125rem",
	fontWeight: 600,
	color: "#b45309",
};

function getBoardStyle(isMobile: boolean): React.CSSProperties {
	return {
		display: "grid",
		gridTemplateColumns: isMobile ? "1fr" : "repeat(4, 1fr)",
		gap: isMobile ? "1rem" : "1.25rem",
		flex: 1,
		minHeight: 0,
	};
}

function getColumnStyle(isMobile: boolean): React.CSSProperties {
	return {
		display: "flex",
		flexDirection: "column",
		minHeight: isMobile ? "auto" : "400px",
		background: "#fff",
		borderRadius: "0.75rem",
		border: "1px solid #e5e7eb",
		overflow: "hidden",
	};
}

function getColumnHeaderStyle(_dotColor: string): React.CSSProperties {
	return {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		padding: "0.875rem 1rem",
		borderBottom: "1px solid #e5e7eb",
		background: "#fafaf9",
	};
}

const columnTitleRowStyle: React.CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: "0.5rem",
};

function getDotStyle(color: string): React.CSSProperties {
	return {
		width: "0.5rem",
		height: "0.5rem",
		borderRadius: "50%",
		background: color,
	};
}

const columnTitleStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.9375rem",
	fontWeight: 700,
	color: "#1f2933",
};

function getBadgeStyle(bg: string, text: string): React.CSSProperties {
	return {
		display: "inline-flex",
		alignItems: "center",
		justifyContent: "center",
		minWidth: "1.5rem",
		height: "1.5rem",
		padding: "0 0.375rem",
		borderRadius: "0.375rem",
		background: bg,
		color: text,
		fontSize: "0.75rem",
		fontWeight: 700,
	};
}

const columnBodyStyle: React.CSSProperties = {
	flex: 1,
	padding: "0.75rem",
	overflow: "auto",
	display: "flex",
	flexDirection: "column",
	gap: "0.625rem",
};

const emptyColumnStyle: React.CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	flex: 1,
	minHeight: "120px",
	color: "#9ca3af",
	fontSize: "0.8125rem",
};

function getCardStyle(hasFailedInstance: boolean): React.CSSProperties {
	return {
		display: "flex",
		flexDirection: "column",
		gap: "0.5rem",
		padding: "0.875rem",
		background: "#fff",
		borderRadius: "0.5rem",
		border: `1px solid ${hasFailedInstance ? "#fecaca" : "#f3f4f6"}`,
	};
}

const cardHeaderStyle: React.CSSProperties = {
	display: "flex",
	justifyContent: "space-between",
	alignItems: "flex-start",
	gap: "0.5rem",
};

const cardTitleBlockStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "0.125rem",
	minWidth: 0,
};

const cardAgentNameStyle: React.CSSProperties = {
	fontSize: "0.9375rem",
	fontWeight: 700,
	color: "#1f2933",
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
};

const cardInstanceStyle: React.CSSProperties = {
	fontSize: "0.75rem",
	color: "#6b7280",
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
};

function getStatusBadgeStyle(tone: "error" | "active" | "idle" | "done"): React.CSSProperties {
	const styles: Record<"error" | "active" | "idle" | "done", { bg: string; color: string }> = {
		error: { bg: "#fee2e2", color: "#991b1b" },
		active: { bg: "#dcfce7", color: "#166534" },
		idle: { bg: "#fef3c7", color: "#92400e" },
		done: { bg: "#d1fae5", color: "#065f46" },
	};
	return {
		padding: "0.25rem 0.5rem",
		borderRadius: "0.25rem",
		background: styles[tone].bg,
		color: styles[tone].color,
		fontSize: "0.6875rem",
		fontWeight: 700,
		whiteSpace: "nowrap",
		flexShrink: 0,
	};
}

const cardBodyStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.8125rem",
	color: "#4b5563",
	lineHeight: 1.5,
};

const cardMetaStyle: React.CSSProperties = {
	display: "flex",
	flexWrap: "wrap",
	gap: "0.5rem",
};

const metaLabelStyle: React.CSSProperties = {
	fontSize: "0.6875rem",
	color: "#9ca3af",
};

const diagnosticAlertStyle: React.CSSProperties = {
	padding: "0.5rem",
	background: "#fef2f2",
	borderRadius: "0.375rem",
	borderLeft: "3px solid #ef4444",
};

const diagnosticAlertTextStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.75rem",
	color: "#991b1b",
};

const drillDownLinkStyle: React.CSSProperties = {
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	padding: "0.375rem 0.75rem",
	borderRadius: "0.375rem",
	background: "#1f2933",
	color: "#fff",
	textDecoration: "none",
	fontSize: "0.75rem",
	fontWeight: 600,
	alignSelf: "flex-start",
};

const emptyStateStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "center",
	gap: "0.75rem",
	padding: "3rem 1.5rem",
	flex: 1,
	background: "#fff",
	borderRadius: "0.75rem",
	border: "1px solid #e5e7eb",
};

const emptyTitleStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "1rem",
	fontWeight: 700,
	color: "#1f2933",
};

const emptyHintStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.875rem",
	color: "#6b7280",
	textAlign: "center",
};

const emptyLinkStyle: React.CSSProperties = {
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	padding: "0.5rem 1rem",
	borderRadius: "0.5rem",
	background: "#1f2933",
	color: "#fff",
	textDecoration: "none",
	fontSize: "0.875rem",
	fontWeight: 600,
};