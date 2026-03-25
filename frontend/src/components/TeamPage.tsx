import type { CSSProperties, JSX } from "react";
import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import {
	ApiError,
	getAggregateOverview,
	listSessions,
	previewSessions,
} from "../api/client";
import type {
	AgentStatus,
	AggregateOverviewAgentItem,
	ErrorEnvelope,
	SessionListItem,
} from "../api/types";
import { useIsMobile } from "../hooks/useIsMobile";
import { buildSessionEntryPath } from "./SessionPage";

const SESSION_OPENING_PREVIEW_MAX_LENGTH = 72;

interface TeamAgentCardRecord {
	agentId: string;
	agentName: string;
	instanceName: string;
	statusLabel: string;
	avatarText: string;
	avatarTone: AvatarTone;
	lastSessionTimeLabel: string;
	sessionOpeningText: string;
	sessionEntry: TeamSessionEntry;
}

interface TeamAgentCardBuildResult {
	card: TeamAgentCardRecord;
	derivedDiagnostics: string[];
}

type TeamSessionEntry =
	| {
			kind: "latest-session";
			path: string;
			badgeLabel: string;
			description: string;
			actionLabel: string;
	  }
	| {
			kind: "fallback-workspace";
			path: string;
			badgeLabel: string;
			description: string;
			actionLabel: string;
	  }
	| {
			kind: "disabled";
			badgeLabel: string;
			description: string;
			actionLabel: string;
	  };

type NavigableTeamSessionEntry = Exclude<TeamSessionEntry, { kind: "disabled" }>;

interface AvatarTone {
	background: string;
	color: string;
	borderColor: string;
}

const avatarTones: readonly AvatarTone[] = [
	{ background: "#f5e5d3", color: "#7d4d23", borderColor: "#e8c9aa" },
	{ background: "#d9ece5", color: "#185a4a", borderColor: "#b6d9cf" },
	{ background: "#dce6f7", color: "#27508a", borderColor: "#bfd2ef" },
	{ background: "#f0dfdd", color: "#8d3d37", borderColor: "#e4bbb7" },
];

const loadingCardIds = ["alpha", "beta", "gamma"] as const;

export function TeamPage(): JSX.Element {
	const isMobile = useIsMobile();
	const location = useLocation();
	const navigate = useNavigate();
	const [cards, setCards] = useState<TeamAgentCardRecord[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<Error | null>(null);
	const [failedStateDetail, setFailedStateDetail] = useState<string | null>(null);

	const loadCards = useCallback(async () => {
		setLoading(true);
		setError(null);
		setFailedStateDetail(null);

		try {
			const overview = await getAggregateOverview();
			const payloadFailed = overview.freshness.status === "failed";

			if (payloadFailed) {
				setCards([]);
				setFailedStateDetail(
					"当前返回的团队聚合结果已标记为失败，请结合请求线索排查。",
				);
				return;
			}

			const nextCardResults = await Promise.all(
				[...overview.agents]
					.sort(sortAgentsForStage)
					.map((agent) => buildTeamAgentCard(agent, location.search)),
			);

			setCards(nextCardResults.map((result) => result.card));
		} catch (nextError) {
			setError(
				nextError instanceof Error ? nextError : new Error("获取团队页失败"),
			);
			setCards([]);
		} finally {
			setLoading(false);
		}
	}, [location.search]);

	useEffect(() => {
		void loadCards();
	}, [loadCards]);

	return (
		<section aria-label="team-page" style={getContainerStyle(isMobile)}>
			{loading ? (
				<TeamLoadingStage isMobile={isMobile} />
			) : error ? (
				<TeamErrorState error={error} onRetry={loadCards} />
			) : failedStateDetail ? (
				<TeamPayloadFailedState detail={failedStateDetail} onRetry={loadCards} />
			) : (
				<section style={stageStyle}>
					{cards.length === 0 ? (
						<div style={emptyStateStyle}>
							当前没有可展示的 persistent agents
						</div>
					) : (
						<div
							style={getCardGridStyle(isMobile)}
							data-testid="team-agent-cards-stage"
						>
							{cards.map((card) => {
								const navigableSessionEntry = getNavigableSessionEntry(
									card.sessionEntry,
								);
								const isEntryEnabled = navigableSessionEntry !== null;

								return (
									<article
										key={card.agentId}
										style={getCardStyle(isEntryEnabled)}
										data-testid={`team-agent-card-${card.agentId}`}
										role={isEntryEnabled ? "link" : undefined}
										tabIndex={isEntryEnabled ? 0 : undefined}
										onClick={
											navigableSessionEntry === null
												? undefined
												: () => {
														navigate(navigableSessionEntry.path);
												  }
										}
										onKeyDown={
											navigableSessionEntry === null
												? undefined
												: (event) => {
														if (event.key !== "Enter" && event.key !== " ") {
															return;
														}
														event.preventDefault();
														navigate(navigableSessionEntry.path);
												  }
										}
										aria-disabled={!isEntryEnabled}
									>
									<div style={cardHeaderStyle}>
										<div
											role="img"
											aria-label={`${card.agentName} 头像`}
											style={{
												...avatarStyle,
												background: card.avatarTone.background,
												color: card.avatarTone.color,
												borderColor: card.avatarTone.borderColor,
											}}
										>
											{card.avatarText}
										</div>
										<div style={cardTitleWrapStyle}>
											<span style={cardKickerStyle}>agent identity</span>
											<h3 style={cardTitleStyle}>{card.agentName}</h3>
											<p style={instanceTextStyle}>{card.instanceName}</p>
										</div>
										<span style={getStatusBadgeStyle(card.statusLabel)}>
											{card.statusLabel}
										</span>
									</div>

									<div style={fieldBlockStyle}>
										<span style={fieldLabelStyle}>最后会话</span>
										<strong style={fieldValueStyle}>
											{card.lastSessionTimeLabel}
										</strong>
									</div>

									<div style={previewPanelStyle}>
										<span style={fieldLabelStyle}>会话开头</span>
										<p style={previewTextStyle}>{card.sessionOpeningText}</p>
									</div>

									<div style={cardFooterStyle}>
										<div style={entryRuleCopyStyle}>
											<span style={getEntryBadgeStyle(card.sessionEntry.kind)}>
												{card.sessionEntry.badgeLabel}
											</span>
											<span style={cardFooterHintStyle}>
												{card.sessionEntry.description}
											</span>
										</div>

										{navigableSessionEntry === null ? (
											<button
												type="button"
												style={disabledEntryButtonStyle}
												disabled
											>
												{card.sessionEntry.actionLabel}
											</button>
										) : (
											<Link
												to={navigableSessionEntry.path}
												style={entryLinkStyle}
												onClick={(event) => {
													event.stopPropagation();
												}}
											>
												{card.sessionEntry.actionLabel}
											</Link>
										)}
									</div>
									</article>
								);
							})}
						</div>
					)}
				</section>
			)}
		</section>
	);
}

function TeamLoadingStage({ isMobile }: { isMobile: boolean }): JSX.Element {
	return (
		<section style={stageStyle}>
			<div style={getCardGridStyle(isMobile)} data-testid="team-agent-cards-stage">
				{loadingCardIds.slice(0, isMobile ? 2 : 3).map((loadingCardId) => (
					<article
						key={`loading-card-${loadingCardId}`}
						style={loadingCardStyle}
					>
						<div style={loadingAvatarStyle} />
						<div style={loadingLinePrimaryStyle} />
						<div style={loadingLineSecondaryStyle} />
						<div style={loadingPanelStyle} />
						<div style={loadingPanelStyle} />
					</article>
				))}
			</div>
		</section>
	);
}

function TeamErrorState({
	error,
	onRetry,
}: {
	error: Error;
	onRetry: () => Promise<void>;
}): JSX.Element {
	const envelope = error instanceof ApiError ? error.envelope : null;
	const unauthorized =
		error instanceof ApiError && error.envelope?.code === "unauthorized";

	return (
		<section style={errorPanelStyle}>
			<div style={errorTextWrapStyle}>
				<h2 style={sectionTitleStyle}>
					{unauthorized ? "当前无权查看团队页" : "团队页暂时不可用"}
				</h2>
				<p style={bodyTextStyle}>{error.message}</p>
				{envelope ? <TeamErrorDetails envelope={envelope} /> : null}
			</div>
			<button
				type="button"
				style={actionButtonStyle}
				onClick={() => void onRetry()}
			>
				重试
			</button>
		</section>
	);
}

function TeamErrorDetails({ envelope }: { envelope: ErrorEnvelope }): JSX.Element {
	return (
		<div style={errorMetaListStyle}>
			<p style={errorMetaTextStyle}>code · {envelope.code}</p>
			<p style={errorMetaTextStyle}>request_id · {envelope.request_id}</p>
			<p style={errorMetaTextStyle}>
				recoverable · {String(envelope.recoverable)}
			</p>
			{envelope.next_step ? (
				<p style={errorMetaHintStyle}>{envelope.next_step}</p>
			) : null}
		</div>
	);
}

function TeamPayloadFailedState({
	detail,
	onRetry,
}: {
	detail: string;
	onRetry: () => Promise<void>;
}): JSX.Element {
	return (
		<section style={errorPanelStyle}>
			<div style={errorTextWrapStyle}>
				<h2 style={sectionTitleStyle}>团队页暂时不可用</h2>
				<p style={bodyTextStyle}>{detail}</p>
			</div>
			<button
				type="button"
				style={actionButtonStyle}
				onClick={() => void onRetry()}
			>
				重试
			</button>
		</section>
	);
}

async function buildTeamAgentCard(
	agent: AggregateOverviewAgentItem,
	search: string,
): Promise<TeamAgentCardBuildResult> {
	const derivedDiagnostics: string[] = [];
	const hasEntryContext = hasSessionEntryContext(agent);
	const latestSessionResult = hasEntryContext
		? await getLatestSession(agent)
		: { latestSession: null, readFailed: false };
	const latestSession = latestSessionResult.latestSession;
	const lastSessionTimeLabel = latestSession
		? formatSessionTime(latestSession.updated_at)
		: latestSessionResult.readFailed
			? "读取失败，待重试"
		: "暂无会话";
	const sessionOpeningResult = latestSession
		? await getSessionOpeningText(agent.instance_id, latestSession.key)
		: { text: "暂无会话开头", readFailed: latestSessionResult.readFailed };

	if (latestSessionResult.readFailed) {
		derivedDiagnostics.push(`${agent.agent_name}（会话列表）`);
	}
	if (sessionOpeningResult.readFailed && latestSession) {
		derivedDiagnostics.push(`${agent.agent_name}（会话开头）`);
	}

	return {
		card: {
			agentId: agent.agent_id,
			agentName: agent.agent_name,
			instanceName: agent.instance_name,
			statusLabel: formatStatusLabel(agent.status),
			avatarText: getAvatarText(agent.agent_name),
			avatarTone: getAvatarTone(`${agent.instance_id}:${agent.agent_id}`),
			lastSessionTimeLabel,
			sessionOpeningText: sessionOpeningResult.text,
			sessionEntry: buildTeamSessionEntry(
				agent,
				latestSession,
				search,
				latestSessionResult.readFailed,
			),
		},
		derivedDiagnostics,
	};
}

function buildTeamSessionEntry(
	agent: AggregateOverviewAgentItem,
	latestSession: SessionListItem | null,
	search: string,
	latestSessionReadFailed = false,
): TeamSessionEntry {
	if (!hasSessionEntryContext(agent)) {
		return {
			kind: "disabled",
			badgeLabel: "入口不可用：缺少基础上下文",
			description: "缺少实例或 agent 标识，当前不能安全进入 session 工作区。",
			actionLabel: "当前不可进入 session 工作区",
		};
	}

	if (latestSessionReadFailed) {
		return {
			kind: "fallback-workspace",
			path: buildSessionEntryPath({
				instanceId: agent.instance_id,
				agentId: agent.agent_id,
				search,
			}),
			badgeLabel: "临时落点：默认工作区",
			description: "最近会话读取失败，当前先进入默认工作区复核。",
			actionLabel: "进入默认工作区",
		};
	}

	if (latestSession) {
		return {
			kind: "latest-session",
			path: buildSessionEntryPath({
				instanceId: agent.instance_id,
				agentId: agent.agent_id,
				search,
				preferredSessionKey: latestSession.key,
			}),
			badgeLabel: "默认落点：最近活跃会话",
			description: "将优先进入该 agent 最近活跃的会话。",
			actionLabel: "进入最近活跃会话",
		};
	}

	return {
		kind: "fallback-workspace",
		path: buildSessionEntryPath({
			instanceId: agent.instance_id,
			agentId: agent.agent_id,
			search,
		}),
		badgeLabel: "默认落点：当前默认工作区",
		description: "暂无历史会话，将先进入当前默认工作区。",
		actionLabel: "进入默认工作区",
	};
}

function getNavigableSessionEntry(
	entry: TeamSessionEntry,
): NavigableTeamSessionEntry | null {
	return entry.kind === "disabled" ? null : entry;
}

function hasSessionEntryContext(
	agent: Pick<AggregateOverviewAgentItem, "instance_id" | "agent_id">,
): boolean {
	return (
		agent.instance_id.trim().length > 0 && agent.agent_id.trim().length > 0
	);
}

async function getLatestSession(
	agent: AggregateOverviewAgentItem,
): Promise<{ latestSession: SessionListItem | null; readFailed: boolean }> {
	try {
		const response = await listSessions(agent.agent_id, {
			instanceId: agent.instance_id,
		});
		return {
			latestSession: [...response.sessions].sort(sortSessionsByRecent)[0] ?? null,
			readFailed: false,
		};
	} catch {
		return { latestSession: null, readFailed: true };
	}
}

async function getSessionOpeningText(
	instanceId: string,
	sessionKey: string,
): Promise<{ text: string; readFailed: boolean }> {
	try {
		const response = await previewSessions([sessionKey], { instanceId });
		const preview = response.previews.find(
			(item) => item.key === sessionKey && item.status === "ok",
		);
		const firstText = preview?.items
			.find((item) => item.text.trim().length > 0)
			?.text.trim();
		return {
			text: firstText
				? truncateText(firstText, SESSION_OPENING_PREVIEW_MAX_LENGTH)
				: "暂无会话开头",
			readFailed: false,
		};
	} catch {
		return { text: "会话开头读取失败，待重试", readFailed: true };
	}
}

function sortAgentsForStage(
	left: AggregateOverviewAgentItem,
	right: AggregateOverviewAgentItem,
): number {
	const byActivity = compareNullableIsoDates(
		right.last_active_at,
		left.last_active_at,
	);
	if (byActivity !== 0) {
		return byActivity;
	}
	return left.agent_name.localeCompare(right.agent_name, "zh-CN");
}

function sortSessionsByRecent(
	left: SessionListItem,
	right: SessionListItem,
): number {
	const byUpdatedAt = (right.updated_at ?? -1) - (left.updated_at ?? -1);
	if (byUpdatedAt !== 0) {
		return byUpdatedAt;
	}
	return left.key.localeCompare(right.key, "en");
}

function compareNullableIsoDates(
	left: string | null,
	right: string | null,
): number {
	const leftTime = left ? Date.parse(left) : -1;
	const rightTime = right ? Date.parse(right) : -1;
	return leftTime - rightTime;
}

function formatStatusLabel(status: AgentStatus): string {
	if (status === "running") {
		return "运行中";
	}
	if (status === "finished") {
		return "已完成";
	}
	if (status === "error") {
		return "异常";
	}
	return "空闲";
}

function formatSessionTime(timestamp: number | null): string {
	if (timestamp === null) {
		return "暂无会话";
	}

	const date = new Date(timestamp * 1000);
	if (Number.isNaN(date.getTime())) {
		return "未知时间";
	}
	return date.toISOString().slice(0, 16).replace("T", " ");
}

function truncateText(value: string, maxLength: number): string {
	if (value.length <= maxLength) {
		return value;
	}
	return `${value.slice(0, maxLength).trimEnd()}…`;
}

function getAvatarText(name: string): string {
	const trimmedName = name.trim();
	if (!trimmedName) {
		return "AG";
	}

	const words = trimmedName.split(/\s+/).filter(Boolean);
	if (words.length >= 2) {
		return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
	}

	return trimmedName.slice(0, 2).toUpperCase();
}

function getAvatarTone(seed: string): AvatarTone {
	const hash = Array.from(seed).reduce(
		(sum, char) => sum + char.charCodeAt(0),
		0,
	);
	return avatarTones[hash % avatarTones.length];
}

function getContainerStyle(isMobile: boolean): CSSProperties {
	return {
		minHeight: "100%",
		padding: isMobile ? "1.25rem 1rem 5rem" : "2rem",
		display: "flex",
		flexDirection: "column",
		gap: "1.5rem",
		background: "#f4f1ea",
		color: "#1f2933",
		overflow: "auto",
		boxSizing: "border-box",
	};
}

function getCardGridStyle(isMobile: boolean): CSSProperties {
	return {
		display: "grid",
		gridTemplateColumns: isMobile
			? "1fr"
			: "repeat(auto-fit, minmax(280px, 1fr))",
		gap: "1rem",
	};
}

function getStatusBadgeStyle(statusLabel: string): CSSProperties {
	const palette =
		statusLabel === "运行中"
			? { background: "#d9ece5", color: "#185a4a", borderColor: "#b6d9cf" }
			: statusLabel === "异常"
				? { background: "#f0dfdd", color: "#8d3d37", borderColor: "#e4bbb7" }
				: statusLabel === "已完成"
					? { background: "#dce6f7", color: "#27508a", borderColor: "#bfd2ef" }
					: { background: "#ede3d6", color: "#7b5b34", borderColor: "#deccb6" };

	return {
		alignSelf: "flex-start",
		padding: "0.35rem 0.7rem",
		borderRadius: "999px",
		border: `1px solid ${palette.borderColor}`,
		background: palette.background,
		color: palette.color,
		fontSize: "0.75rem",
		fontWeight: 700,
		whiteSpace: "nowrap",
	};
}

const actionButtonStyle: CSSProperties = {
	border: "1px solid #d8c7b4",
	borderRadius: "999px",
	padding: "0.6rem 1rem",
	background: "rgba(255, 255, 255, 0.88)",
	color: "#1f2933",
	fontSize: "0.8rem",
	fontWeight: 700,
	cursor: "pointer",
};

const sectionTitleStyle: CSSProperties = {
	margin: 0,
	fontSize: "1.1rem",
	fontWeight: 700,
	color: "#1f2933",
};

const bodyTextStyle: CSSProperties = {
	margin: 0,
	fontSize: "0.95rem",
	lineHeight: 1.7,
	color: "#52606d",
};

const stageStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "1rem",
};

function getCardStyle(isClickable: boolean): CSSProperties {
	return {
		display: "flex",
		flexDirection: "column",
		gap: "1rem",
		minHeight: "18rem",
		padding: "1.2rem",
		borderRadius: "1.1rem",
		background: "#fffdf8",
		border: "1px solid #e6dccf",
		boxShadow: "0 22px 40px -30px rgba(85, 56, 29, 0.35)",
		cursor: isClickable ? "pointer" : "default",
	};
}

function getEntryBadgeStyle(kind: TeamSessionEntry["kind"]): CSSProperties {
	const palette =
		kind === "latest-session"
			? { background: "#d9ece5", color: "#185a4a", borderColor: "#b6d9cf" }
			: kind === "fallback-workspace"
				? { background: "#ede3d6", color: "#7b5b34", borderColor: "#deccb6" }
				: { background: "#f0dfdd", color: "#8d3d37", borderColor: "#e4bbb7" };

	return {
		alignSelf: "flex-start",
		padding: "0.32rem 0.65rem",
		borderRadius: "999px",
		border: `1px solid ${palette.borderColor}`,
		background: palette.background,
		color: palette.color,
		fontSize: "0.72rem",
		fontWeight: 700,
	};
}

const entryRuleCopyStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "0.45rem",
};

const cardHeaderStyle: CSSProperties = {
	display: "grid",
	gridTemplateColumns: "auto minmax(0, 1fr) auto",
	gap: "0.9rem",
	alignItems: "center",
};

const avatarStyle: CSSProperties = {
	width: "3.25rem",
	height: "3.25rem",
	borderRadius: "0.95rem",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	fontSize: "1rem",
	fontWeight: 800,
	border: "1px solid transparent",
	flexShrink: 0,
};

const cardTitleWrapStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "0.2rem",
	minWidth: 0,
};

const cardKickerStyle: CSSProperties = {
	fontSize: "0.68rem",
	textTransform: "uppercase",
	letterSpacing: "0.08em",
	fontWeight: 700,
	color: "#9a6b39",
};

const cardTitleStyle: CSSProperties = {
	margin: 0,
	fontSize: "1.15rem",
	fontWeight: 700,
	color: "#1f2933",
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
};

const instanceTextStyle: CSSProperties = {
	margin: 0,
	fontSize: "0.82rem",
	color: "#6b7280",
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
};

const fieldBlockStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "0.35rem",
	padding: "0.85rem 0.9rem",
	borderRadius: "0.9rem",
	background: "#faf4ea",
	border: "1px solid #e9dcc9",
};

const fieldLabelStyle: CSSProperties = {
	fontSize: "0.72rem",
	fontWeight: 700,
	letterSpacing: "0.04em",
	textTransform: "uppercase",
	color: "#8b5e34",
};

const fieldValueStyle: CSSProperties = {
	fontSize: "0.95rem",
	fontWeight: 700,
	color: "#1f2933",
};

const previewPanelStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "0.45rem",
	padding: "0.95rem 1rem",
	borderRadius: "1rem",
	background: "linear-gradient(180deg, #ffffff 0%, #f8f3ea 100%)",
	border: "1px solid #ece2d3",
	minHeight: "6.75rem",
};

const previewTextStyle: CSSProperties = {
	margin: 0,
	fontSize: "0.86rem",
	lineHeight: 1.65,
	color: "#334155",
	wordBreak: "break-word",
};

const cardFooterStyle: CSSProperties = {
	marginTop: "auto",
	paddingTop: "0.1rem",
	display: "flex",
	justifyContent: "space-between",
	alignItems: "flex-end",
	gap: "0.75rem",
	flexWrap: "wrap",
};

const cardFooterHintStyle: CSSProperties = {
	fontSize: "0.75rem",
	lineHeight: 1.5,
	color: "#8a6a45",
};

const entryLinkStyle: CSSProperties = {
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	padding: "0.65rem 0.95rem",
	borderRadius: "999px",
	background: "#1f2933",
	color: "#fffdf8",
	textDecoration: "none",
	fontSize: "0.8rem",
	fontWeight: 700,
	whiteSpace: "nowrap",
};

const disabledEntryButtonStyle: CSSProperties = {
	padding: "0.65rem 0.95rem",
	borderRadius: "999px",
	border: "1px solid #ddcfc1",
	background: "#f4ede4",
	color: "#9a8771",
	fontSize: "0.8rem",
	fontWeight: 700,
	cursor: "not-allowed",
};

const emptyStateStyle: CSSProperties = {
	padding: "1.25rem",
	borderRadius: "1rem",
	border: "1px dashed #d8c7b4",
	background: "#fffdf8",
	color: "#6b7280",
	fontSize: "0.9rem",
};

const errorPanelStyle: CSSProperties = {
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	gap: "1rem",
	flexWrap: "wrap",
	padding: "1rem 1.1rem",
	borderRadius: "1rem",
	border: "1px solid #e7cdc8",
	background: "#fff6f4",
};

const errorTextWrapStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "0.3rem",
};

const errorMetaListStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "0.25rem",
};

const errorMetaTextStyle: CSSProperties = {
	margin: 0,
	fontSize: "0.8rem",
	fontWeight: 700,
	color: "#8d3d37",
};

const errorMetaHintStyle: CSSProperties = {
	margin: 0,
	fontSize: "0.8rem",
	lineHeight: 1.5,
	color: "#7b4f3e",
};

const loadingCardStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "0.9rem",
	minHeight: "18rem",
	padding: "1.2rem",
	borderRadius: "1.1rem",
	background: "#fffdf8",
	border: "1px solid #e6dccf",
};

const loadingAvatarStyle: CSSProperties = {
	width: "3.25rem",
	height: "3.25rem",
	borderRadius: "0.95rem",
	background: "#f0e6d9",
};

const loadingLinePrimaryStyle: CSSProperties = {
	width: "58%",
	height: "1rem",
	borderRadius: "999px",
	background: "#f0e6d9",
};

const loadingLineSecondaryStyle: CSSProperties = {
	width: "42%",
	height: "0.85rem",
	borderRadius: "999px",
	background: "#f4ecdf",
};

const loadingPanelStyle: CSSProperties = {
	width: "100%",
	height: "4.8rem",
	borderRadius: "1rem",
	background: "#f7efe4",
};
