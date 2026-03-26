import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, getAggregateOverview } from "../api/client";
import type {
	AggregateInstanceDiagnostic,
	AggregateOverviewGlobalEvent,
	AggregateOverviewResponse,
	AggregateOverviewTokenGroup,
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

	const handleReload = useCallback(() => {
		void loadOverview();
	}, [loadOverview]);

	if (loading) {
		return (
			<div style={getContainerStyle(isMobile)}>
				<LoadingStatsPanel />
				<div style={getMainLayoutStyle(isMobile)}>
					<LoadingTokenStage />
					<LoadingEventsRail isMobile={isMobile} />
				</div>
			</div>
		);
	}

	if (error) {
		const envelope = error instanceof ApiError ? error.envelope : null;
		const unauthorized = envelope?.code === "unauthorized";
		return (
			<div style={getContainerStyle(isMobile)}>
				<div style={errorPanelStyle}>
					<h2 style={errorTitleStyle}>
						{unauthorized ? "当前无权查看总览" : "总览暂时不可用"}
					</h2>
					<p style={errorStyle}>{error.message}</p>
					{envelope ? <EnvelopeErrorSummary envelope={envelope} /> : null}
					<button type="button" style={actionButtonStyle} onClick={handleReload}>
						重试
					</button>
				</div>
			</div>
		);
	}

	if (!overview) {
		return (
			<div style={getContainerStyle(isMobile)}>
				<div style={emptyPanelStyle}>当前没有可展示的总览数据</div>
			</div>
		);
	}

	const diagnosticsByInstance = new Map(
		overview.diagnostics.map((item) => [item.instance_id, item]),
	);

	return (
		<div style={getContainerStyle(isMobile)}>
			<StatsPanel overview={overview} onReload={handleReload} />
			<div style={getMainLayoutStyle(isMobile)}>
				<TokenStage
					tokenGroups={overview.token_groups}
					diagnosticsByInstance={diagnosticsByInstance}
					isMobile={isMobile}
				/>
				<GlobalEventsRail events={overview.global_events} isMobile={isMobile} />
			</div>
		</div>
	);
}

function LoadingStatsPanel(): JSX.Element {
	return (
		<div style={statsPanelStyle} data-testid="overview-stats-panel">
			<div style={loadingCardStyle}>总览数据加载中</div>
			<div style={loadingCardStyle}>实例统计加载中</div>
			<div style={loadingCardStyle}>活跃状态加载中</div>
			<div style={loadingCardStyle}>Token 汇总加载中</div>
		</div>
	);
}

function LoadingTokenStage(): JSX.Element {
	return (
		<section style={tokenStageStyle} data-testid="overview-token-stage">
			<div style={stageHeaderStyle}>
				<h2 style={sectionTitleStyle}>实例 token 趋势</h2>
				<p style={sectionHintStyle}>按实例分组展示当前可得的 token 消耗走势。</p>
			</div>
			<div style={loadingPanelStyle}>正在加载实例 token 趋势</div>
		</section>
	);
}

function LoadingEventsRail({ isMobile }: { isMobile: boolean }): JSX.Element {
	return (
		<aside
			style={getEventsRailStyle(isMobile)}
			data-testid="overview-global-events"
		>
			<div style={stageHeaderStyle}>
				<h2 style={sectionTitleStyle}>全局事件</h2>
				<p style={sectionHintStyle}>保留跨实例的最新活动与异常线索。</p>
			</div>
			<div style={loadingPanelStyle}>正在加载全局事件</div>
		</aside>
	);
}

function StatsPanel({
	overview,
	onReload,
}: {
	overview: AggregateOverviewResponse;
	onReload: () => void;
}): JSX.Element {
	const stats = useMemo(
		() => [
			{ label: "实例总数", value: formatCount(overview.stats.instance_count) },
			{ label: "活跃 agents", value: formatCount(overview.stats.active_agent_count) },
			{ label: "关注实例", value: formatCount(overview.stats.attention_instance_count) },
			{ label: "Token 总量", value: formatTokenTotal(overview.stats.total_tokens) },
		],
		[overview],
	);

	return (
		<div style={overviewStatsCardStyle} data-testid="overview-stats-panel">
			<div style={statsActionRowStyle}>
				<button type="button" style={actionButtonStyle} onClick={onReload}>
					刷新
				</button>
			</div>
			<div style={statsGridStyle}>
				{stats.map((item) => (
					<div key={item.label} style={statsItemStyle}>
						<span style={statsLabelStyle}>{item.label}</span>
						<span style={statsValueStyle}>{item.value}</span>
					</div>
				))}
			</div>
		</div>
	);
}

function TokenStage({
	tokenGroups,
	diagnosticsByInstance,
	isMobile,
}: {
	tokenGroups: AggregateOverviewTokenGroup[];
	diagnosticsByInstance: Map<string, AggregateInstanceDiagnostic>;
	isMobile: boolean;
}): JSX.Element {
	return (
		<section style={tokenStageStyle} data-testid="overview-token-stage">
			<div style={stageHeaderStyle}>
				<h2 style={sectionTitleStyle}>实例 token 趋势</h2>
				<p style={sectionHintStyle}>按实例分组展示当前可得的 token 消耗走势。</p>
			</div>
			<div style={getTokenGroupGridStyle(isMobile)}>
				{tokenGroups.length === 0 ? (
					<div style={emptyPanelStyle}>当前没有可展示的实例 token 数据</div>
				) : (
					tokenGroups.map((group) => (
						<TokenGroupCard
							key={group.instance_id}
							group={group}
							diagnostic={diagnosticsByInstance.get(group.instance_id)}
						/>
					))
				)}
			</div>
		</section>
	);
}

function TokenGroupCard({
	group,
	diagnostic,
}: {
	group: AggregateOverviewTokenGroup;
	diagnostic?: AggregateInstanceDiagnostic;
}): JSX.Element {
	return (
		<article style={tokenCardStyle}>
			<div style={tokenCardHeaderStyle}>
				<div>
					<h3 style={tokenCardTitleStyle}>{group.instance_name}</h3>
					<p style={tokenCardMetaStyle}>
						{diagnostic ? formatFreshnessLabel(diagnostic.freshness.status) : "状态未知"}
					</p>
				</div>
				<div style={tokenCardTotalStyle}>
					<span style={tokenCardTotalLabelStyle}>累计 token</span>
					<strong style={tokenCardTotalValueStyle}>
						{formatTokenTotal(group.total_tokens)}
					</strong>
				</div>
			</div>

			{group.samples.length === 0 ? (
				<div style={emptyTokenChartStyle}>暂无 token 数据</div>
			) : (
				<div style={sparklineWrapStyle}>
					<div style={sparklineBarsStyle}>
						{group.samples.map((sample) => (
							<div key={`${group.instance_id}:${sample.label}`} style={sparklineColumnStyle}>
								<div
									style={{
										...sparklineBarStyle,
										height: `${getBarHeight(group.samples, sample.total_tokens)}%`,
									}}
								/>
								<span style={sparklineLabelStyle}>{sample.label}</span>
							</div>
						))}
					</div>
				</div>
			)}
		</article>
	);
}

function GlobalEventsRail({
	events,
	isMobile,
}: {
	events: AggregateOverviewGlobalEvent[];
	isMobile: boolean;
}): JSX.Element {
	return (
		<aside
			style={getEventsRailStyle(isMobile)}
			data-testid="overview-global-events"
		>
			<div style={stageHeaderStyle}>
				<h2 style={sectionTitleStyle}>全局事件</h2>
				<p style={sectionHintStyle}>保留跨实例的最新活动与异常线索。</p>
			</div>
			{events.length === 0 ? (
				<div style={emptyPanelStyle}>当前没有可展示的全局事件</div>
			) : (
				<div style={eventListStyle}>
					{events.map((event, index) => (
						<article key={`${event.id}:${event.instance_id}:${index}`} style={eventCardStyle}>
							<p style={eventMetaStyle}>
								{event.instance_name}
								{event.agent_name ? ` · ${event.agent_name}` : ""}
							</p>
							<p style={eventDescriptionStyle}>{event.description}</p>
							<p style={eventTimestampStyle}>{event.timestamp}</p>
						</article>
					))}
				</div>
			)}
		</aside>
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

function formatCount(value: number): string {
	return value.toLocaleString("en-US");
}

function formatTokenTotal(value: number | null): string {
	if (value === null) {
		return "暂无数据";
	}
	return value.toLocaleString("en-US");
}

function formatFreshnessLabel(status: string): string {
	if (status === "fresh") {
		return "数据新鲜";
	}
	if (status === "stale") {
		return "数据滞后";
	}
	if (status === "failed") {
		return "数据失败";
	}
	return status;
}

function getBarHeight(
	samples: AggregateOverviewTokenGroup["samples"],
	value: number,
): number {
	const maxValue = Math.max(...samples.map((sample) => sample.total_tokens), 1);
	return Math.max((value / maxValue) * 100, 18);
}

function getContainerStyle(isMobile: boolean): React.CSSProperties {
	return {
		height: "100%",
		padding: isMobile ? "0.75rem" : "1.5rem",
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

function getMainLayoutStyle(isMobile: boolean): React.CSSProperties {
	return {
		display: "flex",
		flexDirection: isMobile ? "column" : "row",
		gap: isMobile ? "0.875rem" : "1rem",
		minHeight: 0,
		flex: 1,
	};
}

function getTokenGroupGridStyle(isMobile: boolean): React.CSSProperties {
	return {
		display: "grid",
		gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(280px, 1fr))",
		gap: isMobile ? "0.75rem" : "1rem",
	};
}

function getEventsRailStyle(isMobile: boolean): React.CSSProperties {
	return {
		width: isMobile ? "100%" : "320px",
		flexShrink: 0,
		background: "rgba(255, 255, 255, 0.78)",
		border: "1px solid #ded6c7",
		borderRadius: "1rem",
		padding: "1rem",
		display: "flex",
		flexDirection: "column",
		gap: "0.75rem",
		maxHeight: isMobile ? "36vh" : undefined,
		overflow: isMobile ? "auto" : undefined,
	};
}

const statsActionRowStyle: React.CSSProperties = {
	display: "flex",
	justifyContent: "flex-end",
};

const actionButtonStyle: React.CSSProperties = {
	border: "1px solid #d4c8b6",
	borderRadius: "999px",
	padding: "0.45rem 0.9rem",
	background: "rgba(255, 255, 255, 0.9)",
	color: "#1f2933",
	fontSize: "0.75rem",
	fontWeight: 600,
	cursor: "pointer",
	whiteSpace: "nowrap",
};

const statsPanelStyle: React.CSSProperties = {
	display: "grid",
	gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
	gap: "0.75rem",
};

const statsGridStyle: React.CSSProperties = {
	...statsPanelStyle,
	gap: "1rem",
};

const statsItemStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "0.35rem",
};

const overviewStatsCardStyle: React.CSSProperties = {
	background: "rgba(255, 255, 255, 0.88)",
	border: "1px solid #ded6c7",
	borderRadius: "1rem",
	padding: "1rem",
	display: "flex",
	flexDirection: "column",
	gap: "1rem",
};

const statsCardStyle: React.CSSProperties = {
	background: "rgba(255, 255, 255, 0.88)",
	border: "1px solid #ded6c7",
	borderRadius: "0.875rem",
	padding: "0.875rem 1rem",
	display: "flex",
	flexDirection: "column",
	gap: "0.35rem",
};

const statsLabelStyle: React.CSSProperties = {
	fontSize: "0.75rem",
	color: "#6b7280",
	fontWeight: 600,
};

const statsValueStyle: React.CSSProperties = {
	fontSize: "1.4rem",
	lineHeight: 1.1,
	fontWeight: 700,
	color: "#1f2933",
};

const tokenStageStyle: React.CSSProperties = {
	flex: 1,
	background: "rgba(255, 255, 255, 0.78)",
	border: "1px solid #ded6c7",
	borderRadius: "1rem",
	padding: "1rem",
	display: "flex",
	flexDirection: "column",
	gap: "1rem",
	minWidth: 0,
};

const stageHeaderStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "0.2rem",
};

const sectionTitleStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "1rem",
	fontWeight: 700,
	color: "#1f2933",
};

const sectionHintStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.75rem",
	color: "#6b7280",
};

const tokenCardStyle: React.CSSProperties = {
	border: "1px solid #e8e0d2",
	borderRadius: "0.875rem",
	padding: "0.9rem",
	background: "#fcfaf6",
	display: "flex",
	flexDirection: "column",
	gap: "0.75rem",
};

const tokenCardHeaderStyle: React.CSSProperties = {
	display: "flex",
	justifyContent: "space-between",
	gap: "0.75rem",
	alignItems: "flex-start",
};

const tokenCardTitleStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.95rem",
	fontWeight: 700,
	color: "#1f2933",
};

const tokenCardMetaStyle: React.CSSProperties = {
	margin: "0.2rem 0 0 0",
	fontSize: "0.75rem",
	color: "#6b7280",
};

const tokenCardTotalStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	alignItems: "flex-end",
	gap: "0.15rem",
};

const tokenCardTotalLabelStyle: React.CSSProperties = {
	fontSize: "0.7rem",
	color: "#6b7280",
};

const tokenCardTotalValueStyle: React.CSSProperties = {
	fontSize: "0.95rem",
	color: "#1f2933",
};

const sparklineWrapStyle: React.CSSProperties = {
	borderRadius: "0.75rem",
	background: "linear-gradient(180deg, #f5f0e8 0%, #efe7da 100%)",
	padding: "0.75rem",
};

const sparklineBarsStyle: React.CSSProperties = {
	display: "flex",
	alignItems: "flex-end",
	gap: "0.75rem",
	height: "140px",
};

const sparklineColumnStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	justifyContent: "flex-end",
	alignItems: "center",
	gap: "0.5rem",
	flex: 1,
	height: "100%",
};

const sparklineBarStyle: React.CSSProperties = {
	width: "100%",
	minHeight: "18px",
	borderRadius: "999px 999px 0 0",
	background: "linear-gradient(180deg, #1d8f6a 0%, #145642 100%)",
};

const sparklineLabelStyle: React.CSSProperties = {
	fontSize: "0.7rem",
	color: "#6b7280",
};

const eventListStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "0.75rem",
};

const eventCardStyle: React.CSSProperties = {
	padding: "0.75rem",
	borderRadius: "0.8rem",
	background: "#fcfaf6",
	border: "1px solid #ece3d5",
	display: "flex",
	flexDirection: "column",
	gap: "0.3rem",
};

const eventMetaStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.7rem",
	fontWeight: 700,
	color: "#8b5e34",
};

const eventDescriptionStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.8125rem",
	color: "#1f2933",
};

const eventTimestampStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.7rem",
	color: "#6b7280",
};

const emptyPanelStyle: React.CSSProperties = {
	padding: "1rem",
	borderRadius: "0.8rem",
	background: "#fcfaf6",
	border: "1px dashed #d4c8b6",
	fontSize: "0.8125rem",
	color: "#6b7280",
};

const emptyTokenChartStyle: React.CSSProperties = {
	padding: "1rem",
	borderRadius: "0.75rem",
	background: "linear-gradient(180deg, #f5f0e8 0%, #efe7da 100%)",
	fontSize: "0.8125rem",
	color: "#6b7280",
};

const loadingPanelStyle: React.CSSProperties = {
	padding: "1rem",
	borderRadius: "0.8rem",
	background: "rgba(252, 250, 246, 0.96)",
	border: "1px dashed #d4c8b6",
	fontSize: "0.8125rem",
	color: "#6b7280",
};

const loadingCardStyle: React.CSSProperties = {
	...statsCardStyle,
	justifyContent: "center",
	minHeight: "4.75rem",
	fontSize: "0.8125rem",
	color: "#6b7280",
	fontWeight: 600,
};

const errorPanelStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	alignItems: "flex-start",
	gap: "0.5rem",
	padding: "2rem",
	background: "rgba(255, 255, 255, 0.82)",
	border: "1px solid #ded6c7",
	borderRadius: "1rem",
};

const errorTitleStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "1.1rem",
	fontWeight: 700,
	color: "#1f2933",
};

const errorMetaListStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "0.25rem",
	alignItems: "flex-start",
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
	textAlign: "left",
};

const errorStyle: React.CSSProperties = {
	color: "#6b7280",
	textAlign: "left",
	margin: 0,
};
