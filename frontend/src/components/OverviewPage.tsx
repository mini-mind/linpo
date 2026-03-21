import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getAggregateOverview } from "../api/client";
import type {
	AggregateInstanceDiagnostic,
	AggregateOverviewAgentItem,
	AggregateOverviewResponse,
} from "../api/types";
import { useIsMobile } from "../hooks/useIsMobile";

export function OverviewPage(): JSX.Element {
	const isMobile = useIsMobile();
	const [overview, setOverview] = useState<AggregateOverviewResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const loadOverview = useCallback(async () => {
		try {
			setLoading(true);
			setError(null);
			const data = await getAggregateOverview();
			setOverview(data);
		} catch (err) {
			const message = err instanceof Error ? err.message : "获取总览失败";
			setError(message);
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
		return (
			<div style={getContainerStyle(isMobile)}>
				<p style={errorStyle}>错误: {error}</p>
			</div>
		);
	}

	const agents = overview?.agents ?? [];
	const diagnostics = overview?.diagnostics ?? [];
	const activeAgents = agents.filter((agent) => agent.is_active).length;
	const watchlistAgents = agents.filter(isWatchlistAgent).length;

	return (
		<div style={getContainerStyle(isMobile)}>
			<div style={headerStyle}>
				<h1 style={titleStyle}>总览</h1>
				<p style={subtitleStyle}>全部 agents 的聚合观察入口</p>
			</div>

			<div style={getStatsGridStyle(isMobile)}>
				<div style={getStatCardStyle(isMobile)}>
					<span style={statLabelStyle}>全部 agents</span>
					<span style={statValueStyle}>{agents.length}</span>
				</div>
				<div style={getStatCardStyle(isMobile, "success")}>
					<span style={statLabelStyle}>活跃中</span>
					<span style={getStatValueColorStyle("success")}>{activeAgents}</span>
				</div>
				<div style={getStatCardStyle(isMobile, "warning")}>
					<span style={statLabelStyle}>值得巡视</span>
					<span style={getStatValueColorStyle("warning")}>
						{watchlistAgents}
					</span>
				</div>
			</div>

			{overview ? (
				<div style={summaryPanelStyle}>
					<div style={summaryItemStyle}>
						<span style={summaryLabelStyle}>聚合 freshness</span>
						<strong style={summaryValueStyle}>
							{formatFreshnessSummary(overview.freshness.status, overview.freshness.checked_at)}
						</strong>
					</div>
					<div style={summaryItemStyle}>
						<span style={summaryLabelStyle}>request id</span>
						<strong style={summaryValueStyle}>{overview.request_id}</strong>
					</div>
					<div style={summaryItemStyle}>
						<span style={summaryLabelStyle}>诊断状态</span>
						<strong style={summaryValueStyle}>
							{overview.partial_failure ? "部分降级" : "稳定"}
						</strong>
					</div>
				</div>
			) : null}

			{diagnostics.length > 0 ? (
				<div style={diagnosticsSectionStyle}>
					<h2 style={sectionTitleStyle}>实例诊断</h2>
					<div style={diagnosticsGridStyle}>
						{diagnostics.map((diagnostic) => (
							<div
								key={diagnostic.instance_id}
								style={getDiagnosticCardStyle(diagnostic.status === "failed")}
							>
								<div style={diagnosticHeaderStyle}>
									<span style={diagnosticNameStyle}>
										{diagnostic.instance_name}
									</span>
									<div style={diagnosticBadgeGroupStyle}>
										<span style={getDiagnosticBadgeStyle(diagnostic.status)}>
											{diagnostic.status}
										</span>
										<span style={getDiagnosticBadgeStyle(diagnostic.freshness.status)}>
											{diagnostic.freshness.status}
										</span>
									</div>
								</div>
								<p style={diagnosticMessageStyle}>{getDiagnosticMessage(diagnostic)}</p>
								<div style={diagnosticMetaListStyle}>
									<p style={diagnosticMetaStyle}>
										checked_at · {diagnostic.freshness.checked_at ?? "未提供"}
									</p>
									{diagnostic.error ? (
										<>
											<p style={diagnosticMetaStyle}>code · {diagnostic.error.code}</p>
											<p style={diagnosticMetaStyle}>
												request_id · {diagnostic.error.request_id}
											</p>
											<p style={diagnosticMetaStyle}>
												recoverable · {String(diagnostic.error.recoverable)}
											</p>
										</>
									) : (
										<p style={diagnosticMetaStyle}>code · ok</p>
									)}
								</div>
								{diagnostic.error?.next_step ? (
									<p style={diagnosticHintStyle}>{diagnostic.error.next_step}</p>
								) : null}
							</div>
						))}
					</div>
				</div>
			) : null}

			{agents.length === 0 ? (
				<div style={emptyStateStyle}>
					<p style={emptyTitleStyle}>当前没有可下钻的 agent</p>
					<p style={emptyHintStyle}>前往拓扑查看实例接入与当前配置。</p>
					<p style={emptyHintStyle}>
						先巡视 watchlist 与接入状态，确认哪些实例值得继续观察。
					</p>
					<Link to="/topology" style={emptyLinkStyle}>
						前往拓扑
					</Link>
				</div>
			) : (
				<>
					<div style={getAgentGridStyle(isMobile)}>
						{agents.map((agent) => (
							<AgentCard key={`${agent.instance_id}:${agent.agent_id}`} agent={agent} />
						))}
					</div>

					<div style={navigationStyle}>
						<Link to="/topology" style={navLinkStyle}>
							<span style={navIconStyle}>◇</span>
							查看拓扑
						</Link>
					</div>
				</>
			)}
		</div>
	);
}

function AgentCard({ agent }: { agent: AggregateOverviewAgentItem }): JSX.Element {
	return (
		<div style={getAgentCardStyle(isWatchlistAgent(agent))}>
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

function formatFreshnessSummary(status: string, checkedAt: string | null): string {
	return checkedAt ? `${status} · ${checkedAt}` : status;
}

function getDiagnosticMessage(diagnostic: AggregateInstanceDiagnostic): string {
	return diagnostic.error?.message ?? "状态稳定";
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
		padding: isMobile ? "1rem" : "2rem",
		background: "#f4f1ea",
		color: "#1f2933",
		fontFamily:
			'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
		overflow: "auto",
		boxSizing: "border-box",
	};
}

const headerStyle: React.CSSProperties = {
	marginBottom: "1.5rem",
};

const titleStyle: React.CSSProperties = {
	fontSize: "1.5rem",
	fontWeight: 700,
	color: "#1f2933",
	margin: "0 0 0.25rem 0",
};

const subtitleStyle: React.CSSProperties = {
	fontSize: "0.875rem",
	color: "#6b7280",
	margin: 0,
};

function getStatsGridStyle(isMobile: boolean): React.CSSProperties {
	return {
		display: "grid",
		gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)",
		gap: "1rem",
		marginBottom: "1.5rem",
	};
}

function getStatCardStyle(
	isMobile: boolean,
	variant?: "success" | "warning",
): React.CSSProperties {
	const borderColor =
		variant === "success"
			? "#10b981"
			: variant === "warning"
				? "#f59e0b"
				: "#e5e7eb";

	return {
		background: "#fff",
		border: `1px solid ${borderColor}`,
		borderRadius: "0.75rem",
		padding: isMobile ? "1rem" : "1.25rem",
		display: "flex",
		flexDirection: "column",
		gap: "0.5rem",
	};
}

const statLabelStyle: React.CSSProperties = {
	fontSize: "0.75rem",
	color: "#6b7280",
	fontWeight: 500,
	textTransform: "uppercase",
	letterSpacing: "0.05em",
};

const statValueStyle: React.CSSProperties = {
	fontSize: "2rem",
	fontWeight: 700,
	color: "#1f2933",
};

function getStatValueColorStyle(
	variant?: "success" | "warning",
): React.CSSProperties {
	const color =
		variant === "success"
			? "#10b981"
			: variant === "warning"
				? "#f59e0b"
				: "#1f2933";

	return {
		fontSize: "2rem",
		fontWeight: 700,
		color,
	};
}

function getAgentGridStyle(isMobile: boolean): React.CSSProperties {
	return {
		display: "grid",
		gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(280px, 1fr))",
		gap: "1rem",
		marginBottom: "1.5rem",
	};
}

function getAgentCardStyle(isWatchlist: boolean): React.CSSProperties {
	return {
		background: "#fff",
		border: `2px solid ${isWatchlist ? "#f59e0b" : "#10b981"}`,
		borderRadius: "0.75rem",
		padding: "1.25rem",
		display: "flex",
		flexDirection: "column",
		gap: "0.75rem",
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
	gap: "0.25rem",
	minWidth: 0,
};

const agentNameStyle: React.CSSProperties = {
	fontSize: "1rem",
	fontWeight: 600,
	color: "#1f2933",
};

const instanceNameStyle: React.CSSProperties = {
	fontSize: "0.8125rem",
	color: "#6b7280",
};

function getStatusBadgeStyle(
	status: AggregateOverviewAgentItem["status"],
	isActive: boolean,
): React.CSSProperties {
	const isAttention = status === "error" || !isActive;
	return {
		fontSize: "0.75rem",
		padding: "0.125rem 0.5rem",
		borderRadius: "0.25rem",
		background: isAttention ? "#fef3c7" : "#dcfce7",
		color: isAttention ? "#92400e" : "#166534",
		fontWeight: 500,
		whiteSpace: "nowrap",
	};
}

const metaStyle: React.CSSProperties = {
	fontSize: "0.8125rem",
	color: "#6b7280",
	margin: 0,
};

const agentActionsStyle: React.CSSProperties = {
	display: "flex",
	justifyContent: "flex-start",
};

const primaryButtonStyle: React.CSSProperties = {
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	padding: "0.5rem 1rem",
	background: "#3b82f6",
	color: "#fff",
	borderRadius: "0.5rem",
	fontSize: "0.875rem",
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
};

const emptyTitleStyle: React.CSSProperties = {
	fontSize: "1.125rem",
	fontWeight: 600,
	color: "#1f2933",
	margin: "0 0 0.5rem 0",
};

const emptyHintStyle: React.CSSProperties = {
	fontSize: "0.875rem",
	color: "#6b7280",
	margin: "0 0 1rem 0",
};

const summaryPanelStyle: React.CSSProperties = {
	display: "grid",
	gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
	gap: "0.75rem",
	marginBottom: "1.5rem",
};

const summaryItemStyle: React.CSSProperties = {
	background: "rgba(255, 255, 255, 0.72)",
	border: "1px solid #d7d2c8",
	borderRadius: "0.75rem",
	padding: "0.875rem 1rem",
	display: "flex",
	flexDirection: "column",
	gap: "0.35rem",
};

const summaryLabelStyle: React.CSSProperties = {
	fontSize: "0.75rem",
	textTransform: "uppercase",
	letterSpacing: "0.05em",
	color: "#6b7280",
};

const summaryValueStyle: React.CSSProperties = {
	fontSize: "0.95rem",
	fontWeight: 600,
	color: "#1f2933",
	wordBreak: "break-word",
};

const diagnosticsSectionStyle: React.CSSProperties = {
	marginBottom: "1.5rem",
};

const sectionTitleStyle: React.CSSProperties = {
	fontSize: "1rem",
	fontWeight: 600,
	color: "#1f2933",
	margin: "0 0 0.75rem 0",
};

const diagnosticsGridStyle: React.CSSProperties = {
	display: "grid",
	gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
	gap: "0.75rem",
};

function getDiagnosticCardStyle(isFailed: boolean): React.CSSProperties {
	return {
		background: "rgba(255, 255, 255, 0.9)",
		border: `1px solid ${isFailed ? "#f59e0b" : "#e5e7eb"}`,
		borderRadius: "0.75rem",
		padding: "1rem",
		display: "flex",
		flexDirection: "column",
		gap: "0.5rem",
	};
}

const diagnosticHeaderStyle: React.CSSProperties = {
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	gap: "0.75rem",
};

const diagnosticBadgeGroupStyle: React.CSSProperties = {
	display: "flex",
	gap: "0.375rem",
	flexWrap: "wrap",
	justifyContent: "flex-end",
};

const diagnosticNameStyle: React.CSSProperties = {
	fontSize: "0.9rem",
	fontWeight: 600,
	color: "#1f2933",
};


function getDiagnosticBadgeStyle(status: string): React.CSSProperties {
	const isFailed = status === "failed";
	const isFresh = status === "fresh" || status === "ok";
	return {
		fontSize: "0.75rem",
		padding: "0.125rem 0.5rem",
		borderRadius: "999px",
		background: isFailed ? "#fef3c7" : isFresh ? "#ecfdf5" : "#eff6ff",
		color: isFailed ? "#92400e" : isFresh ? "#166534" : "#1d4ed8",
		fontWeight: 600,
	};
}

const diagnosticMessageStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.875rem",
	color: "#1f2933",
};

const diagnosticMetaListStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "0.25rem",
};

const diagnosticMetaStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.75rem",
	color: "#6b7280",
	fontFamily: 'ui-monospace, SFMono-Regular, "SFMono-Regular", Consolas, monospace',
};

const diagnosticHintStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.8125rem",
	color: "#6b7280",
};

const emptyLinkStyle: React.CSSProperties = {
	display: "inline-flex",
	alignItems: "center",
	gap: "0.5rem",
	padding: "0.625rem 1.25rem",
	background: "#3b82f6",
	color: "#fff",
	borderRadius: "0.5rem",
	fontSize: "0.875rem",
	fontWeight: 500,
	textDecoration: "none",
};

const navigationStyle: React.CSSProperties = {
	display: "flex",
	gap: "1rem",
	flexWrap: "wrap",
};

const navLinkStyle: React.CSSProperties = {
	display: "inline-flex",
	alignItems: "center",
	gap: "0.5rem",
	padding: "0.75rem 1.25rem",
	background: "#fff",
	color: "#3b82f6",
	border: "1px solid #e5e7eb",
	borderRadius: "0.5rem",
	fontSize: "0.875rem",
	fontWeight: 500,
	textDecoration: "none",
};

const navIconStyle: React.CSSProperties = {
	fontSize: "1rem",
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
