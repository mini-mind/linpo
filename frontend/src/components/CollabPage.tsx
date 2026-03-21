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

	if (loading) {
		return (
			<section aria-label="kanban-page" style={getContainerStyle(isMobile)}>
				<p style={textStyle}>加载中...</p>
			</section>
		);
	}

	if (error) {
		const envelope = error instanceof ApiError ? error.envelope : null;
		return (
			<section aria-label="kanban-page" style={getContainerStyle(isMobile)}>
				<div style={errorPanelStyle}>
					<p style={errorStyle}>错误: {error.message}</p>
					{envelope ? <EnvelopeErrorSummary envelope={envelope} /> : null}
				</div>
			</section>
		);
	}

	const agents = overview?.agents ?? [];
	const diagnostics = overview?.diagnostics ?? [];
	const activeAgents = agents.filter((agent) => agent.is_active).length;
	const watchlistAgents = agents.filter(isWatchlistAgent).length;

	return (
		<section aria-label="kanban-page" style={getContainerStyle(isMobile)}>
			<div style={headerStyle}>
				<h1 style={titleStyle}>看板</h1>
				<p style={subtitleStyle}>聚合工作项、协作状态与关键工作信号</p>
			</div>

			<div style={getStatsGridStyle(isMobile)}>
				<div style={getStatCardStyle(isMobile)}>
					<span style={statLabelStyle}>全部信号</span>
					<span style={statValueStyle}>{agents.length}</span>
				</div>
				<div style={getStatCardStyle(isMobile, "success")}>
					<span style={statLabelStyle}>活跃协作</span>
					<span style={getStatValueColorStyle("success")}>{activeAgents}</span>
				</div>
				<div style={getStatCardStyle(isMobile, "warning")}>
					<span style={statLabelStyle}>待跟进</span>
					<span style={getStatValueColorStyle("warning")}>{watchlistAgents}</span>
				</div>
			</div>

			{overview ? (
				<div style={summaryPanelStyle}>
					<div style={summaryItemStyle}>
						<span style={summaryLabelStyle}>聚合 freshness</span>
						<strong style={summaryValueStyle}>
							{formatFreshnessSummary(
								overview.freshness.status,
								overview.freshness.checked_at,
							)}
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
										<span
											style={getDiagnosticBadgeStyle(
												diagnostic.freshness.status,
											)}
										>
											{diagnostic.freshness.status}
										</span>
									</div>
								</div>
								<p style={diagnosticMessageStyle}>
									{getDiagnosticMessage(diagnostic)}
								</p>
								<div style={diagnosticMetaListStyle}>
									<p style={diagnosticMetaStyle}>
										checked_at · {diagnostic.freshness.checked_at ?? "未提供"}
									</p>
									{diagnostic.error ? (
										<>
											<p style={diagnosticMetaStyle}>
												code · {diagnostic.error.code}
											</p>
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
					<p style={emptyTitleStyle}>当前没有可接管的工作信号</p>
					<p style={emptyHintStyle}>先回到总览或拓扑确认哪些 agent 值得继续跟进。</p>
					<Link to="/overview" style={emptyLinkStyle}>
						返回总览
					</Link>
				</div>
			) : (
				<div style={signalGridStyle}>
					{agents.map((agent) => (
						<SignalCard key={`${agent.instance_id}:${agent.agent_id}`} agent={agent} />
					))}
				</div>
			)}
		</section>
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

function SignalCard({ agent }: { agent: AggregateOverviewAgentItem }): JSX.Element {
	return (
		<article style={getSignalCardStyle(isWatchlistAgent(agent))}>
			<div style={signalHeaderStyle}>
				<div style={signalTitleBlockStyle}>
					<span style={signalNameStyle}>{agent.agent_name}</span>
					<span style={signalInstanceStyle}>{agent.instance_name}</span>
				</div>
				<span style={getStatusBadgeStyle(agent.status, agent.is_active)}>
					{getStatusLabel(agent)}
				</span>
			</div>
			<p style={signalBodyStyle}>{getSignalSummary(agent)}</p>
			<p style={signalMetaStyle}>
				{agent.last_active_at ? `最近活动 ${agent.last_active_at}` : "最近活动暂未上报"}
			</p>
			<Link
				to={agent.drilldown_path}
				style={sessionLinkStyle}
				aria-label={`进入会话 - ${agent.agent_name}`}
			>
				进入会话
			</Link>
		</article>
	);
}

function isWatchlistAgent(agent: AggregateOverviewAgentItem): boolean {
	return agent.status === "error" || !agent.is_active;
}

function getSignalSummary(agent: AggregateOverviewAgentItem): string {
	if (agent.status === "error") return "存在待处理异常，建议立即接管。";
	if (agent.status === "running") return "工作流正在推进，可直接进入会话跟进。";
	if (agent.status === "finished") return "最近一次工作已完成，可复盘上下文。";
	return agent.is_active ? "保持待命，可随时进入会话接管。" : "当前信号较弱，建议纳入 follow-up。";
}

function formatFreshnessSummary(status: string, checkedAt: string | null): string {
	return checkedAt ? `${status} · ${checkedAt}` : status;
}

function getDiagnosticMessage(diagnostic: AggregateInstanceDiagnostic): string {
	return diagnostic.error?.message ?? "状态稳定";
}

function getStatusLabel(agent: AggregateOverviewAgentItem): string {
	if (agent.status === "error") return "异常";
	if (agent.status === "running") return "运行中";
	if (agent.status === "finished") return "已完成";
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

const textStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.875rem",
	color: "#6b7280",
};

const errorPanelStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	gap: "0.5rem",
	padding: "2rem",
};

const errorStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.9375rem",
	fontWeight: 600,
	color: "#b91c1c",
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
	tone: "default" | "success" | "warning" = "default",
): React.CSSProperties {
	const borderByTone = {
		default: "#e5e7eb",
		success: "#86efac",
		warning: "#fcd34d",
	};
	return {
		background: "#fff",
		borderRadius: "0.75rem",
		border: `1px solid ${borderByTone[tone]}`,
		padding: isMobile ? "1rem" : "1.25rem",
		display: "flex",
		flexDirection: "column",
		gap: "0.35rem",
	};
}

const statLabelStyle: React.CSSProperties = {
	fontSize: "0.8125rem",
	color: "#6b7280",
};

const statValueStyle: React.CSSProperties = {
	fontSize: "1.75rem",
	fontWeight: 700,
	color: "#1f2933",
};

function getStatValueColorStyle(tone: "success" | "warning"): React.CSSProperties {
	return {
		...statValueStyle,
		color: tone === "success" ? "#166534" : "#b45309",
	};
}

const summaryPanelStyle: React.CSSProperties = {
	display: "grid",
	gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
	gap: "0.75rem",
	marginBottom: "1.5rem",
	padding: "1rem",
	background: "#fff",
	borderRadius: "0.75rem",
	border: "1px solid #e5e7eb",
};

const summaryItemStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "0.25rem",
};

const summaryLabelStyle: React.CSSProperties = {
	fontSize: "0.75rem",
	color: "#6b7280",
	textTransform: "none",
};

const summaryValueStyle: React.CSSProperties = {
	fontSize: "0.875rem",
	color: "#1f2933",
};

const diagnosticsSectionStyle: React.CSSProperties = {
	marginBottom: "1.5rem",
};

const sectionTitleStyle: React.CSSProperties = {
	margin: "0 0 0.75rem 0",
	fontSize: "1rem",
	fontWeight: 700,
	color: "#1f2933",
};

const diagnosticsGridStyle: React.CSSProperties = {
	display: "grid",
	gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
	gap: "0.75rem",
};

function getDiagnosticCardStyle(isFailed: boolean): React.CSSProperties {
	return {
		background: "#fff",
		borderRadius: "0.75rem",
		border: `1px solid ${isFailed ? "#fecaca" : "#e5e7eb"}`,
		padding: "1rem",
		display: "flex",
		flexDirection: "column",
		gap: "0.5rem",
	};
}

const diagnosticHeaderStyle: React.CSSProperties = {
	display: "flex",
	justifyContent: "space-between",
	gap: "0.75rem",
	alignItems: "flex-start",
};

const diagnosticNameStyle: React.CSSProperties = {
	fontSize: "0.9375rem",
	fontWeight: 600,
	color: "#1f2933",
};

const diagnosticBadgeGroupStyle: React.CSSProperties = {
	display: "flex",
	gap: "0.35rem",
	flexWrap: "wrap",
	justifyContent: "flex-end",
};

function getDiagnosticBadgeStyle(status: string): React.CSSProperties {
	const tone =
		status === "failed" || status === "error"
			? { background: "#fee2e2", color: "#b91c1c" }
			: status === "fresh" || status === "ok"
				? { background: "#dcfce7", color: "#166534" }
				: { background: "#fef3c7", color: "#b45309" };
	return {
		padding: "0.2rem 0.45rem",
		borderRadius: "9999px",
		fontSize: "0.6875rem",
		fontWeight: 600,
		...tone,
	};
}

const diagnosticMessageStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.875rem",
	color: "#374151",
};

const diagnosticMetaListStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "0.2rem",
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

const emptyStateStyle: React.CSSProperties = {
	background: "#fff",
	borderRadius: "0.75rem",
	border: "1px solid #e5e7eb",
	padding: "1.5rem",
	display: "flex",
	flexDirection: "column",
	gap: "0.5rem",
	alignItems: "flex-start",
};

const emptyTitleStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "1rem",
	fontWeight: 600,
	color: "#1f2933",
};

const emptyHintStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.875rem",
	color: "#6b7280",
};

const emptyLinkStyle: React.CSSProperties = {
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	padding: "0.55rem 0.9rem",
	borderRadius: "9999px",
	background: "#1f2933",
	color: "#fff",
	textDecoration: "none",
	fontSize: "0.875rem",
	fontWeight: 600,
};

const signalGridStyle: React.CSSProperties = {
	display: "grid",
	gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
	gap: "0.75rem",
};

function getSignalCardStyle(isWatchlist: boolean): React.CSSProperties {
	return {
		background: "#fff",
		borderRadius: "0.75rem",
		border: `1px solid ${isWatchlist ? "#fcd34d" : "#e5e7eb"}`,
		padding: "1rem",
		display: "flex",
		flexDirection: "column",
		gap: "0.6rem",
	};
}

const signalHeaderStyle: React.CSSProperties = {
	display: "flex",
	justifyContent: "space-between",
	gap: "0.75rem",
	alignItems: "flex-start",
};

const signalTitleBlockStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "0.2rem",
};

const signalNameStyle: React.CSSProperties = {
	fontSize: "0.9375rem",
	fontWeight: 700,
	color: "#1f2933",
};

const signalInstanceStyle: React.CSSProperties = {
	fontSize: "0.75rem",
	color: "#6b7280",
};

const signalBodyStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.875rem",
	color: "#374151",
	lineHeight: 1.5,
};

const signalMetaStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.75rem",
	color: "#6b7280",
};

function getStatusBadgeStyle(status: string, isActive: boolean): React.CSSProperties {
	const tone =
		status === "error"
			? { background: "#fee2e2", color: "#b91c1c" }
			: isActive
				? { background: "#dcfce7", color: "#166534" }
				: { background: "#fef3c7", color: "#b45309" };
	return {
		padding: "0.25rem 0.55rem",
		borderRadius: "9999px",
		fontSize: "0.75rem",
		fontWeight: 600,
		whiteSpace: "nowrap",
		...tone,
	};
}

const sessionLinkStyle: React.CSSProperties = {
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	padding: "0.55rem 0.85rem",
	borderRadius: "9999px",
	background: "#1f2933",
	color: "#fff",
	textDecoration: "none",
	fontSize: "0.875rem",
	fontWeight: 600,
	alignSelf: "flex-start",
};
