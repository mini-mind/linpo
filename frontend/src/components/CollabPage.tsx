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
	description: string;
	dotColor: string;
	badgeBg: string;
	badgeText: string;
};

type TaskStatusTone = "error" | "active" | "idle" | "done";

type KanbanTaskCard = {
	id: string;
	column: KanbanColumn;
	title: string;
	intent: string;
	summary: string;
	statusLabel: string;
	statusTone: TaskStatusTone;
	agentName: string;
	instanceName: string;
	lastActiveAt: string | null;
	errorMessage: string | null;
	drilldownPath: string | null;
	hasFailedInstance: boolean;
};

const TASK_CONTEXT_GUIDANCE = "先确认为什么是这张任务卡，再决定是否跳转到 session 工作区继续推进。";
const SESSION_WORKSPACE_FALLBACK_NOTE = "需先在 topology / team / session 确认可用会话入口";

const COLUMNS: ColumnConfig[] = [
	{
		key: "needs_attention",
		title: "待处理",
		description: "优先处理阻塞、失败与需要接管的任务",
		dotColor: "#dc2626",
		badgeBg: "#fee2e2",
		badgeText: "#991b1b",
	},
	{
		key: "in_progress",
		title: "推进中",
		description: "持续补充上下文，推动任务越过当前阶段",
		dotColor: "#7c3aed",
		badgeBg: "#ede9fe",
		badgeText: "#5b21b6",
	},
	{
		key: "pending_review",
		title: "待确认",
		description: "确认输入、责任人与下一步，再决定是否继续推进",
		dotColor: "#f59e0b",
		badgeBg: "#fef3c7",
		badgeText: "#92400e",
	},
	{
		key: "completed",
		title: "已收尾",
		description: "复盘结果、同步结论并完成收尾动作",
		dotColor: "#10b981",
		badgeBg: "#d1fae5",
		badgeText: "#065f46",
	},
];

function getTaskColumn(agent: AggregateOverviewAgentItem, hasFailedInstance: boolean): KanbanColumn {
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

	const handleReload = useCallback(() => {
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

	const diagnosticsByInstance = useMemo(() => {
		return new Map(
			(overview?.diagnostics ?? []).map((diagnostic) => [diagnostic.instance_id, diagnostic]),
		);
	}, [overview?.diagnostics]);

	const tasksByColumn = useMemo(() => {
		const agents = overview?.agents ?? [];
		const grouped: Record<KanbanColumn, KanbanTaskCard[]> = {
			needs_attention: [],
			in_progress: [],
			pending_review: [],
			completed: [],
		};
		for (const agent of agents) {
			const diagnostic = diagnosticsByInstance.get(agent.instance_id);
			const task = deriveTaskCard(agent, diagnostic, failedInstanceIds.has(agent.instance_id));
			grouped[task.column].push(task);
		}
		return grouped;
	}, [overview?.agents, diagnosticsByInstance, failedInstanceIds]);

	const failedDiagnostics = useMemo(() => {
		return (overview?.diagnostics ?? []).filter((diagnostic) => diagnostic.status === "failed");
	}, [overview?.diagnostics]);

	const boardFocus = useMemo(() => {
		if (loading) {
			return "正在同步任务板上下文";
		}

		const focusOrder: Array<{ key: KanbanColumn; label: string }> = [
			{ key: "needs_attention", label: "优先处理异常阻塞" },
			{ key: "in_progress", label: "跟进推进中的任务" },
			{ key: "pending_review", label: "明确下一步与责任人" },
			{ key: "completed", label: "复盘并收尾最近交付" },
		];

		for (const focus of focusOrder) {
			const count = tasksByColumn[focus.key].length;
			if (count > 0) {
				return `${focus.label} · ${count} 张任务卡`;
			}
		}

		return "等待新的任务上下文进入板面";
	}, [loading, tasksByColumn]);

	const agents = overview?.agents ?? [];
	const totalCards = agents.length;
	const errorEnvelope = error instanceof ApiError ? error.envelope : null;
	const unauthorized = errorEnvelope?.code === "unauthorized";
	const showPartialFailure =
		overview !== null &&
		(overview.partial_failure ||
			(failedDiagnostics.length > 0 && failedDiagnostics.length < overview.diagnostics.length));
	const partialFailureDetail =
		failedDiagnostics.length > 0
			? `受影响实例：${failedDiagnostics.map((item) => item.instance_name).join("、")}`
			: "任务板中的部分实例诊断暂不可用，请结合请求线索继续核对。";
	const diagnosticsSummary = overview
		? `${overview.diagnostics.length} total / ${failedDiagnostics.length} failed`
		: "同步中";
	const subtitle = loading
		? "正在同步 kanban 聚合状态"
		: error
			? unauthorized
				? "当前账号缺少 kanban 读取权限"
				: "聚合读取失败，请根据请求线索排查"
			: `从聚合读链路派生的任务板 · ${totalCards} 张任务卡`;


	return (
		<section aria-label="kanban-page" style={getContainerStyle(isMobile)}>
			<header style={headerStyle}>
				<div style={headerTopRowStyle}>
					<div>
						<h1 style={titleStyle}>看板</h1>
						<p style={subtitleStyle}>{subtitle}</p>
					</div>
					{error ? null : (
						<button
							type="button"
							onClick={handleReload}
							style={refreshButtonStyle}
							disabled={loading}
						>
							刷新任务板
						</button>
					)}
				</div>
			</header>

			{error ? (
				<div style={errorPanelStyle}>
					<p style={errorTitleStyle}>{unauthorized ? "当前无权查看任务板" : "任务板暂时不可用"}</p>
					<p style={errorMessageStyle}>{error.message}</p>
					{errorEnvelope ? <EnvelopeErrorDetails envelope={errorEnvelope} /> : null}
					<button type="button" onClick={handleReload} style={retryButtonStyle}>
						重试
					</button>
				</div>
			) : (
				<>
					{overview ? (
						<KanbanRequestClues
							requestId={overview.request_id}
							freshnessStatus={formatFreshnessLabel(overview.freshness.status)}
							checkedAt={overview.freshness.checked_at}
							diagnosticsSummary={diagnosticsSummary}
						/>
					) : null}
					{loading ? (
						<KanbanStatusNotice
							tone="info"
							title="正在同步 kanban 聚合状态"
							detail="任务板加载中"
						/>
					) : null}
					{!loading && showPartialFailure ? (
						<KanbanStatusNotice
							tone="warning"
							title="部分数据不可用"
							detail={partialFailureDetail}
						/>
					) : null}
					{!loading && overview?.freshness.status === "stale" ? (
						<KanbanStatusNotice
							tone="info"
							title="当前展示的是滞后任务板"
							detail="展示内容仍可用于推进任务，但可能落后于实例最新状态。"
						/>
					) : null}
					<KanbanSummaryStrip
						isMobile={isMobile}
						totalCards={loading ? "同步中" : `${totalCards} 张任务卡`}
						boardFocus={boardFocus}
						freshnessStatus={loading ? "同步中" : formatFreshnessLabel(overview?.freshness.status ?? "fresh")}
						diagnosticsSummary={diagnosticsSummary}
					/>
					{!loading && agents.length === 0 ? <EmptyKanbanState /> : null}
					<KanbanBoard isMobile={isMobile} tasksByColumn={tasksByColumn} loading={loading} />
				</>
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

function KanbanRequestClues({
	requestId,
	freshnessStatus,
	checkedAt,
	diagnosticsSummary,
}: {
	requestId: string;
	freshnessStatus: string;
	checkedAt: string | null;
	diagnosticsSummary: string;
}): JSX.Element {
	return (
		<div style={requestCluesStyle}>
			<p style={requestClueTextStyle}>request_id · {requestId}</p>
			<p style={requestClueTextStyle}>freshness · {freshnessStatus}</p>
			<p style={requestClueTextStyle}>checked_at · {checkedAt ?? "暂未上报"}</p>
			<p style={requestClueTextStyle}>diagnostics · {diagnosticsSummary}</p>
		</div>
	);
}

function KanbanStatusNotice({
	tone,
	title,
	detail,
}: {
	tone: "info" | "warning";
	title: string;
	detail: string;
}): JSX.Element {
	return (
		<div style={getStatusNoticeStyle(tone)}>
			<strong style={statusNoticeTitleStyle}>{title}</strong>
			<p style={statusNoticeDetailStyle}>{detail}</p>
		</div>
	);
}

function KanbanSummaryStrip({
	isMobile,
	totalCards,
	boardFocus,
	freshnessStatus,
	diagnosticsSummary,
}: {
	isMobile: boolean;
	totalCards: string;
	boardFocus: string;
	freshnessStatus: string;
	diagnosticsSummary: string;
}): JSX.Element {
	return (
		<div style={getSummaryStripStyle(isMobile)}>
			<div style={summaryItemStyle}>
				<span style={summaryLabelStyle}>任务总数</span>
				<span style={summaryValueStyle}>{totalCards}</span>
			</div>
			<div style={summaryItemStyle}>
				<span style={summaryLabelStyle}>当前焦点</span>
				<span style={summaryValueStyle}>{boardFocus}</span>
			</div>
			<div style={summaryItemStyle}>
				<span style={summaryLabelStyle}>聚合状态</span>
				<span style={summaryValueStyle}>{freshnessStatus}</span>
			</div>
			<div style={summaryItemStyle}>
				<span style={summaryLabelStyle}>诊断</span>
				<span style={summaryValueStyle}>{diagnosticsSummary}</span>
			</div>
		</div>
	);
}

function EmptyKanbanState(): JSX.Element {
	return (
		<div style={emptyStateStyle}>
			<p style={emptyTitleStyle}>当前还没有可派生的任务卡</p>
			<p style={emptyHintStyle}>
				当前板面已就绪，但还没有真实任务信号进入各列。
			</p>
			<Link to="/topology" style={emptyLinkStyle}>
				去 topology 核对入口
			</Link>
		</div>
	);
}

function KanbanBoard({
	isMobile,
	tasksByColumn,
	loading,
}: {
	isMobile: boolean;
	tasksByColumn: Record<KanbanColumn, KanbanTaskCard[]>;
	loading: boolean;
}): JSX.Element {
	return (
		<div data-testid="kanban-board" style={getBoardStyle(isMobile)}>
			{COLUMNS.map((column) => {
				const columnTasks = tasksByColumn[column.key];
				return (
					<div key={column.key} data-column-key={column.key} style={getColumnStyle(isMobile)}>
						<div style={getColumnHeaderStyle(column.dotColor)}>
							<div style={columnTitleRowStyle}>
								<div style={columnTitleTopRowStyle}>
									<span style={getDotStyle(column.dotColor)} aria-hidden="true" />
									<h2 style={columnTitleStyle}>{column.title}</h2>
								</div>
								<p style={columnDescriptionStyle}>{column.description}</p>
							</div>
							<span style={getBadgeStyle(column.badgeBg, column.badgeText)}>{columnTasks.length}</span>
						</div>
						<div style={columnBodyStyle}>
							{loading ? (
								<div style={emptyColumnStyle}>同步中</div>
							) : columnTasks.length === 0 ? (
								<div style={emptyColumnStyle}>暂无任务</div>
							) : (
								columnTasks.map((task) => <KanbanCard key={task.id} task={task} />)
							)}
						</div>
					</div>
				);
			})}
		</div>
	);
}

interface KanbanCardProps {
	task: KanbanTaskCard;
}

function KanbanCard({ task }: KanbanCardProps): JSX.Element {
	const [contextOpen, setContextOpen] = useState(false);
	const contextPanelId = `task-context-${task.id}`;
	const hasSessionWorkspaceEntry = Boolean(task.drilldownPath);

	return (
		<article style={getCardStyle(task.hasFailedInstance)}>
			<div style={cardHeaderStyle}>
				<div style={cardTitleBlockStyle}>
					<h3 style={cardTitleStyle}>{task.title}</h3>
					<span style={cardSectionLabelStyle}>任务意图</span>
				</div>
				<span style={getStatusBadgeStyle(task.statusTone)}>{task.statusLabel}</span>
			</div>
			<p style={cardIntentStyle}>{task.intent}</p>
			<p style={cardBodyStyle}>{task.summary}</p>
			<div style={cardMetaStyle}>
				<span style={metaLabelStyle}>责任主体 · {task.agentName}</span>
				<span style={metaLabelStyle}>实例上下文 · {task.instanceName}</span>
				{task.lastActiveAt ? (
					<span style={metaLabelStyle}>最近活动 · {task.lastActiveAt}</span>
				) : (
					<span style={metaLabelStyle}>最近活动暂未上报</span>
				)}
			</div>
			{task.errorMessage && (
				<div style={diagnosticAlertStyle}>
					<span style={diagnosticAlertTextStyle}>{task.errorMessage}</span>
				</div>
			)}
			{contextOpen && (
				<div id={contextPanelId} style={taskContextPanelStyle}>
					<span style={taskContextPanelLabelStyle}>任务上下文锚点</span>
					<p style={taskContextPanelBodyStyle}>{TASK_CONTEXT_GUIDANCE}</p>
					<div style={taskContextMetaListStyle}>
						<span style={taskContextMetaItemStyle}>任务意图 · {task.intent}</span>
						<span style={taskContextMetaItemStyle}>当前判断 · {task.summary}</span>
					</div>
				</div>
			)}
			<div style={cardFooterStyle}>
				<div style={cardActionMetaStyle}>
					<span style={cardSectionLabelStyle}>可用动作</span>
					<span style={actionMetaTextStyle}>先进入任务上下文，再决定是否跳转 session 工作区</span>
					<span style={actionMetaTextStyle}>来源 · overview 聚合</span>
				</div>
				<div style={cardActionButtonsStyle}>
					<button
						type="button"
						onClick={() => setContextOpen((open) => !open)}
						aria-expanded={contextOpen}
						aria-controls={contextPanelId}
						style={taskContextButtonStyle}
					>
						{contextOpen ? "收起任务上下文" : "进入任务上下文"}
					</button>
					{hasSessionWorkspaceEntry ? (
						<Link to={task.drilldownPath ?? "/session"} style={sessionWorkspaceLinkStyle}>
							进入 session 工作区
						</Link>
					) : (
						<>
							<button
								type="button"
								disabled
								style={disabledActionButtonStyle}
							>
								进入 session 工作区
							</button>
							<span style={actionFallbackTextStyle}>{SESSION_WORKSPACE_FALLBACK_NOTE}</span>
						</>
					)}
				</div>
			</div>
		</article>
	);
}

function getSessionWorkspaceEntryPath(drilldownPath: string): string | null {
	const normalizedPath = drilldownPath.trim();
	if (!normalizedPath.startsWith("/session/")) {
		return null;
	}
	return normalizedPath;
}

function deriveTaskCard(
	agent: AggregateOverviewAgentItem,
	diagnostic: AggregateInstanceDiagnostic | undefined,
	hasFailedInstance: boolean,
): KanbanTaskCard {
	const column = getTaskColumn(agent, hasFailedInstance);
	const sessionWorkspacePath = getSessionWorkspaceEntryPath(agent.drilldown_path);
	if (column === "needs_attention") {
		return {
			id: `${agent.instance_id}:${agent.agent_id}:attention`,
			column,
			title: `处理 ${agent.agent_name} 的异常阻塞`,
			intent: "先止损、再恢复推进节奏，避免阻塞继续扩散。",
			summary: diagnostic?.error
				? "实例诊断已经标出阻塞，建议进入会话接管、确认影响范围并推动恢复。"
				: "当前任务出现异常阻塞，建议立即进入会话接管并确认恢复动作。",
			statusLabel: "待处理",
			statusTone: "error",
			agentName: agent.agent_name,
			instanceName: agent.instance_name,
			lastActiveAt: agent.last_active_at,
			errorMessage: diagnostic?.error?.message ?? null,
			drilldownPath: sessionWorkspacePath,
			hasFailedInstance,
		};
	}

	if (column === "completed") {
		return {
			id: `${agent.instance_id}:${agent.agent_id}:done`,
			column,
			title: `复盘 ${agent.agent_name} 最近交付`,
			intent: "核对交付结果、同步结论，并把收尾动作落到位。",
			summary: "最近一次工作已完成，建议核对结果、沉淀结论并完成收尾。",
			statusLabel: "已收尾",
			statusTone: "done",
			agentName: agent.agent_name,
			instanceName: agent.instance_name,
			lastActiveAt: agent.last_active_at,
			errorMessage: diagnostic?.error?.message ?? null,
			drilldownPath: sessionWorkspacePath,
			hasFailedInstance,
		};
	}

	if (column === "in_progress") {
		return {
			id: `${agent.instance_id}:${agent.agent_id}:progress`,
			column,
			title: `推进 ${agent.agent_name} 当前任务`,
			intent: "持续补充上下文并推动负责人完成下一步动作。",
			summary: "工作流正在推进，可进入会话补充上下文、清理阻塞并推动下一步。",
			statusLabel: "推进中",
			statusTone: "active",
			agentName: agent.agent_name,
			instanceName: agent.instance_name,
			lastActiveAt: agent.last_active_at,
			errorMessage: diagnostic?.error?.message ?? null,
			drilldownPath: sessionWorkspacePath,
			hasFailedInstance,
		};
	}

	return {
		id: `${agent.instance_id}:${agent.agent_id}:review`,
		column,
		title: `确认 ${agent.agent_name} 下一步任务`,
		intent: "补齐输入、责任人与判断依据，再决定是否继续推进。",
		summary: agent.is_active
			? "当前仍具备接管能力，建议明确输入、负责人和下一步动作。"
			: "当前信号较弱，建议确认是否继续推进、补充输入或改派处理。",
		statusLabel: "待确认",
		statusTone: "idle",
		agentName: agent.agent_name,
		instanceName: agent.instance_name,
		lastActiveAt: agent.last_active_at,
		errorMessage: diagnostic?.error?.message ?? null,
		drilldownPath: sessionWorkspacePath,
		hasFailedInstance,
	};
}

function formatFreshnessLabel(status: string): string {
	if (status === "fresh") return "数据新鲜";
	if (status === "stale") return "数据滞后";
	if (status === "failed") return "读取失败";
	return status;
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

const headerTopRowStyle: React.CSSProperties = {
	display: "flex",
	alignItems: "flex-start",
	justifyContent: "space-between",
	gap: "1rem",
	flexWrap: "wrap",
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

const refreshButtonStyle: React.CSSProperties = {
	...retryButtonStyle,
	background: "#1f2933",
	border: "1px solid #1f2933",
	color: "#fff",
};

const requestCluesStyle: React.CSSProperties = {
	display: "flex",
	flexWrap: "wrap",
	gap: "0.5rem 1rem",
	marginBottom: "0.75rem",
	padding: "0.75rem 1rem",
	background: "#fff",
	borderRadius: "0.5rem",
	border: "1px solid #e5e7eb",
};

const requestClueTextStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.75rem",
	color: "#6b7280",
	fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
};

function getStatusNoticeStyle(tone: "info" | "warning"): React.CSSProperties {
	return {
		display: "flex",
		flexDirection: "column",
		gap: "0.25rem",
		marginBottom: "0.75rem",
		padding: "0.75rem 1rem",
		borderRadius: "0.5rem",
		border: `1px solid ${tone === "warning" ? "#f59e0b" : "#cbd5e1"}`,
		background: tone === "warning" ? "#fffbeb" : "#f8fafc",
	};
}

const statusNoticeTitleStyle: React.CSSProperties = {
	fontSize: "0.8125rem",
	color: "#1f2933",
};

const statusNoticeDetailStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.75rem",
	lineHeight: 1.5,
	color: "#6b7280",
};

function getSummaryStripStyle(isMobile: boolean): React.CSSProperties {
	return {
		display: "flex",
		flexWrap: "wrap",
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

const summaryValueStyle: React.CSSProperties = {
	fontSize: "0.8125rem",
	fontWeight: 600,
	color: "#1f2933",
	lineHeight: 1.5,
};

const summaryLabelStyle: React.CSSProperties = {
	fontSize: "0.6875rem",
	color: "#9ca3af",
	textTransform: "uppercase",
	letterSpacing: "0.05em",
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
	alignItems: "flex-start",
	flexDirection: "column",
	gap: "0.5rem",
};

const columnTitleTopRowStyle: React.CSSProperties = {
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

const columnDescriptionStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.75rem",
	lineHeight: 1.5,
	color: "#6b7280",
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
	gap: "0.25rem",
	minWidth: 0,
};

const cardSectionLabelStyle: React.CSSProperties = {
	fontSize: "0.6875rem",
	fontWeight: 700,
	letterSpacing: "0.04em",
	textTransform: "uppercase",
	color: "#9ca3af",
};

const cardTitleStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.9375rem",
	fontWeight: 700,
	color: "#1f2933",
	overflow: "hidden",
	textOverflow: "ellipsis",
	display: "-webkit-box",
	WebkitLineClamp: 2,
	WebkitBoxOrient: "vertical",
};

function getStatusBadgeStyle(tone: TaskStatusTone): React.CSSProperties {
	const styles: Record<TaskStatusTone, { bg: string; color: string }> = {
		error: { bg: "#fee2e2", color: "#991b1b" },
		active: { bg: "#ede9fe", color: "#5b21b6" },
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

const cardIntentStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.8125rem",
	fontWeight: 600,
	color: "#1f2933",
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

const cardFooterStyle: React.CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	gap: "0.75rem",
	flexWrap: "wrap",
};

const cardActionMetaStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "0.125rem",
};

const actionMetaTextStyle: React.CSSProperties = {
	fontSize: "0.75rem",
	color: "#6b7280",
};

const cardActionButtonsStyle: React.CSSProperties = {
	display: "flex",
	alignItems: "flex-start",
	justifyContent: "flex-end",
	gap: "0.5rem",
	flexWrap: "wrap",
};

const taskContextButtonStyle: React.CSSProperties = {
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	padding: "0.375rem 0.75rem",
	borderRadius: "0.375rem",
	background: "#1f2933",
	border: "1px solid #1f2933",
	color: "#fff",
	fontSize: "0.75rem",
	fontWeight: 600,
	alignSelf: "flex-start",
	cursor: "pointer",
};

const sessionWorkspaceLinkStyle: React.CSSProperties = {
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	padding: "0.375rem 0.75rem",
	borderRadius: "0.375rem",
	background: "#fff",
	border: "1px solid #d1d5db",
	color: "#1f2933",
	textDecoration: "none",
	fontSize: "0.75rem",
	fontWeight: 600,
	alignSelf: "flex-start",
};

const disabledActionButtonStyle: React.CSSProperties = {
	...sessionWorkspaceLinkStyle,
	color: "#9ca3af",
	border: "1px solid #e5e7eb",
	background: "#f9fafb",
	cursor: "not-allowed",
};

const actionFallbackTextStyle: React.CSSProperties = {
	fontSize: "0.75rem",
	color: "#9ca3af",
	maxWidth: "14rem",
	lineHeight: 1.5,
};

const taskContextPanelStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "0.375rem",
	padding: "0.75rem",
	borderRadius: "0.5rem",
	background: "#f8fafc",
	border: "1px solid #e2e8f0",
};

const taskContextPanelLabelStyle: React.CSSProperties = {
	fontSize: "0.6875rem",
	fontWeight: 700,
	letterSpacing: "0.04em",
	textTransform: "uppercase",
	color: "#64748b",
};

const taskContextPanelBodyStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.75rem",
	lineHeight: 1.5,
	color: "#475569",
};

const taskContextMetaListStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "0.25rem",
};

const taskContextMetaItemStyle: React.CSSProperties = {
	fontSize: "0.75rem",
	lineHeight: 1.5,
	color: "#334155",
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
