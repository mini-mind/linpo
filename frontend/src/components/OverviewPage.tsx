import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, getAggregateOverview } from "../api/client";
import type {
	AggregateInstanceDiagnostic,
	AggregateOverviewAgentItem,
	AggregateOverviewResponse,
	ErrorEnvelope,
} from "../api/types";
import { useIsMobile } from "../hooks/useIsMobile";

export function OverviewPage(): JSX.Element {
	const isMobile = useIsMobile();
	const [overview, setOverview] = useState<AggregateOverviewResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<Error | null>(null);

	const loadOverview = useCallback(async () => {
		try {
			setLoading(true);
			setError(null);
			const data = await getAggregateOverview();
			setOverview(data);
		} catch (err) {
			setError(err instanceof Error ? err : new Error("获取总览失败"));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadOverview();
	}, [loadOverview]);

	if (loading) {
		return (
			<div style={getContainerStyle(isMobile)}>
				<p style={textStyle}>加载中...</p>
			</div>
		);
	}

	if (error) {
		const envelope = error instanceof ApiError ? error.envelope : null;
		return (
			<div style={getContainerStyle(isMobile)}>
				<div style={errorPanelStyle}>
					<p style={errorStyle}>错误: {error.message}</p>
					{envelope ? <EnvelopeErrorSummary envelope={envelope} /> : null}
				</div>
			</div>
		);
	}

	const agents = overview?.agents ?? [];
	const diagnostics = overview?.diagnostics ?? [];
	const failedCount = diagnostics.filter((d) => d.status === "failed").length;

	return (
		<div style={getContainerStyle(isMobile)}>
			<div style={headerStyle}>
				<h1 style={titleStyle}>总览</h1>
			</div>

			{overview ? (
				<div style={summaryStripStyle} data-testid="overview-summary-strip">
					<div style={summaryItemStyle}>
						<span style={summaryLabelStyle}>freshness</span>
						<span style={summaryValueStyle}>{overview.freshness.status}</span>
					</div>
					<div style={summaryItemStyle}>
						<span style={summaryLabelStyle}>agents</span>
						<span style={summaryValueStyle}>{agents.length}</span>
					</div>
					{failedCount > 0 ? (
						<div style={summaryItemWarningStyle}>
							<span style={summaryLabelStyle}>异常实例</span>
							<span style={summaryValueWarningStyle}>{failedCount}</span>
						</div>
					) : null}
				</div>
			) : null}

			{agents.length === 0 ? (
				<div style={emptyStateStyle}>
					<p style={emptyTitleStyle}>当前没有可下钻的 agent</p>
					<p style={emptyHintStyle}>前往拓扑查看实例接入与当前配置。</p>
					<Link to="/topology" style={emptyLinkStyle}>
						前往拓扑
					</Link>
				</div>
			) : (
				<div style={getAgentGridStyle(isMobile)} data-testid="overview-agents-grid">
					{agents.map((agent) => {
						const agentDiagnostic = diagnostics.find(
							(d) => d.instance_id === agent.instance_id,
						);
						return (
							<AgentCard
								key={`${agent.instance_id}:${agent.agent_id}`}
								agent={agent}
								diagnostic={agentDiagnostic}
							/>
						);
					})}
				</div>
			)}
		</div>
	);
}

function EnvelopeErrorSummary({ envelope }: { envelope: ErrorEnvelope }): JSX.Element {
	return (
		<div style={errorMetaListStyle}>
			<p style={errorMetaStyle}>code · {envelope.code}</p>
			<p style={errorMetaStyle}>request_id · {envelope.request_id}</p>
			<p style={errorMetaStyle}>recoverable · {String(envelope.recoverable)}</p>
			{envelope.next_step ? <p style={errorHintStyle}>{envelope.next_step}</p> : null}
		</div>
	);
}

function AgentCard({
	agent,
	diagnostic,
}: {
	agent: AggregateOverviewAgentItem;
	diagnostic?: AggregateInstanceDiagnostic;
}): JSX.Element {
	const isWatchlist = isWatchlistAgent(agent);
	const hasError = diagnostic?.status === "failed";

	return (
		<div style={getAgentCardStyle(isWatchlist, hasError)}>
			<div style={agentHeaderStyle}>
				<div style={agentTitleBlockStyle}>
					<span style={agentNameStyle}>{agent.agent_name}</span>
					<span style={instanceNameStyle}>{agent.instance_name}</span>
				</div>
				<span style={getStatusBadgeStyle(agent.status, agent.is_active)}>
					{getStatusLabel(agent)}
				</span>
			</div>
			{agent.last_active_at ? (
				<p style={metaStyle}>最近活动 {agent.last_active_at}</p>
			) : (
				<p style={metaStyle}>最近活动暂未上报</p>
			)}
			{hasError && diagnostic?.error?.message ? (
				<p style={agentDiagnosticStyle}>{diagnostic.error.message}</p>
			) : null}
			<div style={agentActionsStyle}>
				<Link
					to={agent.drilldown_path}
					style={primaryButtonStyle}
					aria-label={`进入会话 - ${agent.agent_name}`}
				>
					进入会话
				</Link>
			</div>
		</div>
	);
}

function isWatchlistAgent(agent: AggregateOverviewAgentItem): boolean {
	return agent.status === "error" || !agent.is_active;
}

function getStatusLabel(agent: AggregateOverviewAgentItem): string {
	if (agent.status === "error") {
		return "异常";
	}
	if (agent.status === "running") {
		return "运行中";
	}
	if (agent.status === "finished") {
		return "已完成";
	}
	return agent.is_active ? "待命中" : "待巡视";
}

function getContainerStyle(isMobile: boolean): React.CSSProperties {
	return {
		height: "100%",
		padding: isMobile ? "1rem" : "1.5rem",
		background: "#f4f1ea",
		color: "#1f2933",
		fontFamily:
			'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
		overflow: "auto",
		boxSizing: "border-box",
		display: "flex",
		flexDirection: "column",
		gap: "1rem",
	};
}

const headerStyle: React.CSSProperties = {
	marginBottom: "0.25rem",
};

const titleStyle: React.CSSProperties = {
	fontSize: "1.25rem",
	fontWeight: 700,
	color: "#1f2933",
	margin: 0,
};

const errorPanelStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	gap: "0.5rem",
	padding: "2rem",
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
	fontFamily: 'ui-monospace, SFMono-Regular, "SFMono-Regular", Consolas, monospace',
};

const errorHintStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.8125rem",
	color: "#6b7280",
	textAlign: "center",
};

const summaryStripStyle: React.CSSProperties = {
	display: "flex",
	gap: "0.75rem",
	flexWrap: "wrap",
	flexShrink: 0,
};

const summaryItemStyle: React.CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: "0.5rem",
	padding: "0.375rem 0.75rem",
	background: "rgba(255, 255, 255, 0.8)",
	border: "1px solid #e5e7eb",
	borderRadius: "0.375rem",
};

const summaryItemWarningStyle: React.CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: "0.5rem",
	padding: "0.375rem 0.75rem",
	background: "#fef3c7",
	border: "1px solid #f59e0b",
	borderRadius: "0.375rem",
};

const summaryLabelStyle: React.CSSProperties = {
	fontSize: "0.75rem",
	color: "#6b7280",
	fontWeight: 500,
};

const summaryValueStyle: React.CSSProperties = {
	fontSize: "0.875rem",
	fontWeight: 600,
	color: "#1f2933",
};

const summaryValueWarningStyle: React.CSSProperties = {
	fontSize: "0.875rem",
	fontWeight: 600,
	color: "#92400e",
};

function getAgentGridStyle(isMobile: boolean): React.CSSProperties {
	return {
		display: "grid",
		gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(300px, 1fr))",
		gap: "1rem",
		flex: 1,
		overflow: "auto",
		alignContent: "start",
	};
}

function getAgentCardStyle(isWatchlist: boolean, hasError: boolean): React.CSSProperties {
	const borderColor = hasError
		? "#ef4444"
		: isWatchlist
			? "#f59e0b"
			: "#10b981";

	return {
		background: "#fff",
		border: `2px solid ${borderColor}`,
		borderRadius: "0.75rem",
		padding: "1rem",
		display: "flex",
		flexDirection: "column",
		gap: "0.5rem",
	};
}

const agentHeaderStyle: React.CSSProperties = {
	display: "flex",
	justifyContent: "space-between",
	alignItems: "flex-start",
	gap: "0.75rem",
};

const agentTitleBlockStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "0.125rem",
	minWidth: 0,
};

const agentNameStyle: React.CSSProperties = {
	fontSize: "0.9375rem",
	fontWeight: 600,
	color: "#1f2933",
};

const instanceNameStyle: React.CSSProperties = {
	fontSize: "0.75rem",
	color: "#6b7280",
};

function getStatusBadgeStyle(
	status: AggregateOverviewAgentItem["status"],
	isActive: boolean,
): React.CSSProperties {
	const isAttention = status === "error" || !isActive;
	return {
		fontSize: "0.6875rem",
		padding: "0.125rem 0.375rem",
		borderRadius: "0.25rem",
		background: isAttention ? "#fef3c7" : "#dcfce7",
		color: isAttention ? "#92400e" : "#166534",
		fontWeight: 500,
		whiteSpace: "nowrap",
	};
}

const metaStyle: React.CSSProperties = {
	fontSize: "0.75rem",
	color: "#6b7280",
	margin: 0,
};

const agentDiagnosticStyle: React.CSSProperties = {
	fontSize: "0.75rem",
	color: "#dc2626",
	margin: 0,
	padding: "0.375rem 0.5rem",
	background: "#fef2f2",
	borderRadius: "0.25rem",
};

const agentActionsStyle: React.CSSProperties = {
	display: "flex",
	justifyContent: "flex-start",
	marginTop: "0.25rem",
};

const primaryButtonStyle: React.CSSProperties = {
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	padding: "0.375rem 0.75rem",
	background: "#3b82f6",
	color: "#fff",
	borderRadius: "0.375rem",
	fontSize: "0.8125rem",
	fontWeight: 500,
	textDecoration: "none",
};

const emptyStateStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "center",
	padding: "3rem 2rem",
	textAlign: "center",
	background: "rgba(255, 255, 255, 0.75)",
	borderRadius: "0.75rem",
	border: "1px solid #e5e7eb",
	flex: 1,
};

const emptyTitleStyle: React.CSSProperties = {
	fontSize: "1rem",
	fontWeight: 600,
	color: "#1f2933",
	margin: "0 0 0.5rem 0",
};

const emptyHintStyle: React.CSSProperties = {
	fontSize: "0.8125rem",
	color: "#6b7280",
	margin: "0 0 1rem 0",
};

const emptyLinkStyle: React.CSSProperties = {
	display: "inline-flex",
	alignItems: "center",
	gap: "0.5rem",
	padding: "0.5rem 1rem",
	background: "#3b82f6",
	color: "#fff",
	borderRadius: "0.375rem",
	fontSize: "0.8125rem",
	fontWeight: 500,
	textDecoration: "none",
};

const textStyle: React.CSSProperties = {
	color: "#6b7280",
	textAlign: "center",
	padding: "2rem",
};

const errorStyle: React.CSSProperties = {
	color: "#dc2626",
	textAlign: "center",
	margin: 0,
};