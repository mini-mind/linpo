import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getAggregateTopology } from "../api/client";
import { listInstances } from "../api/instanceClient";
import type {
	AggregateInstanceDiagnostic,
	AggregateTopologyAgentItem,
	AggregateTopologyExternalAcpItem,
	AggregateTopologyResponse,
	AggregateTopologySkillItem,
	FreshnessInfo,
	InstanceItem,
} from "../api/types";
import { useCurrentInstanceId } from "../hooks/useCurrentInstance";
import { useIsMobile } from "../hooks/useIsMobile";
import { InstanceFormModal } from "./InstanceFormModal";
import { buildCanonicalSessionPath } from "./SessionPage";

type WorkbenchPanel =
	| { kind: "instance-view"; instanceId: string }
	| { kind: "instance-relations"; instanceId: string }
	| { kind: "agent-view"; agentNodeId: string };

function formatDateTime(isoString: string | null): string {
	if (!isoString) {
		return "未上报";
	}

	try {
		return new Date(isoString).toLocaleString("zh-CN", {
			month: "numeric",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
	} catch {
		return isoString;
	}
}

function getInstanceStatusLabel(status: string): string {
	if (status === "active") {
		return "活跃";
	}
	if (status === "inactive") {
		return "未活跃";
	}
	return status || "未知";
}

function getFreshnessLabel(freshness: FreshnessInfo): string {
	if (freshness.status === "fresh") {
		return "fresh";
	}
	if (freshness.status === "stale") {
		return "stale";
	}
	return "failed";
}

function formatFreshnessSummary(freshness: FreshnessInfo): string {
	const label = getFreshnessLabel(freshness);
	return freshness.checked_at ? `${label} · ${freshness.checked_at}` : label;
}

function getDiagnosticMessage(diagnostic: AggregateInstanceDiagnostic): string {
	return diagnostic.error?.message ?? "状态稳定";
}

function getAgentStatusLabel(agent: AggregateTopologyAgentItem): string {
	if (agent.status === "running") {
		return "运行中";
	}
	if (agent.status === "finished") {
		return "已完成";
	}
	if (agent.status === "error") {
		return "异常";
	}
	return agent.is_active ? "待命中" : "待巡视";
}

function getCanonicalAgentPath(agent: AggregateTopologyAgentItem): string {
	return buildCanonicalSessionPath(agent.instance_id, agent.agent_id);
}

function getTopologyItemLabel(
	item: AggregateTopologySkillItem | AggregateTopologyExternalAcpItem,
	fallbackPrefix: string,
	index: number,
): string {
	if (typeof item.name === "string" && item.name) {
		return item.name;
	}
	if (typeof item.label === "string" && item.label) {
		return item.label;
	}
	if (typeof item.id === "string" && item.id) {
		return item.id;
	}
	if (typeof item.node_id === "string" && item.node_id) {
		return item.node_id;
	}
	return `${fallbackPrefix} ${index + 1}`;
}

function buildNodeKey(value: string | undefined, prefix: string, index: number): string {
	if (value) {
		return value;
	}
	return `${prefix}-${index}`;
}

export function InstanceTopology(): JSX.Element {
	const isMobile = useIsMobile();
	const [, setCurrentInstanceId] = useCurrentInstanceId();
	const [topology, setTopology] = useState<AggregateTopologyResponse | null>(null);
	const [instanceConfigs, setInstanceConfigs] = useState<Map<string, InstanceItem>>(
		() => new Map(),
	);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [panel, setPanel] = useState<WorkbenchPanel | null>(null);
	const [editingInstance, setEditingInstance] = useState<InstanceItem | null>(null);

	const loadTopology = useCallback(async (): Promise<void> => {
		try {
			setLoading(true);
			setError(null);
			const data = await getAggregateTopology();
			setTopology(data);
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "获取聚合拓扑失败";
			setError(message);
		} finally {
			setLoading(false);
		}
	}, []);

	const loadInstanceConfigs = useCallback(async (): Promise<void> => {
		try {
			const instances = await listInstances();
			setInstanceConfigs(
				new Map(instances.map((instance) => [instance.id, instance])),
			);
		} catch {
			setInstanceConfigs(new Map());
		}
	}, []);

	useEffect(() => {
		void loadTopology();
		void loadInstanceConfigs();
	}, [loadInstanceConfigs, loadTopology]);

	useEffect(() => {
		if (!topology || panel || topology.instances.length === 0) {
			return;
		}

		setPanel({
			kind: "instance-view",
			instanceId: topology.instances[0].instance_id,
		});
	}, [panel, topology]);

	const diagnosticsByInstanceId = useMemo(() => {
		return new Map(
			(topology?.diagnostics ?? []).map((diagnostic) => [
				diagnostic.instance_id,
				diagnostic,
			]),
		);
	}, [topology]);

	const agentsByNodeId = useMemo(() => {
		return new Map(
			(topology?.agents ?? []).map((agent) => [agent.node_id, agent]),
		);
	}, [topology]);

	const agentsByInstanceId = useMemo(() => {
		const grouped = new Map<string, AggregateTopologyAgentItem[]>();

		for (const agent of topology?.agents ?? []) {
			const current = grouped.get(agent.instance_id) ?? [];
			current.push(agent);
			grouped.set(agent.instance_id, current);
		}

		for (const agents of grouped.values()) {
			agents.sort((left, right) =>
				left.agent_name.localeCompare(right.agent_name, "zh-CN"),
			);
		}

		return grouped;
	}, [topology]);

	const primaryAgentByInstanceId = useMemo(() => {
		const mapping = new Map<string, AggregateTopologyAgentItem>();

		for (const instance of topology?.instances ?? []) {
			const firstAgent = (agentsByInstanceId.get(instance.instance_id) ?? [])[0];
			if (firstAgent) {
				mapping.set(instance.instance_id, firstAgent);
			}
		}

		return mapping;
	}, [agentsByInstanceId, topology]);

	const handleSelectInstance = useCallback(
		(instanceId: string, panelKind: WorkbenchPanel["kind"]): void => {
			setCurrentInstanceId(instanceId);
			if (panelKind === "instance-relations") {
				setPanel({ kind: panelKind, instanceId });
				return;
			}
			setPanel({ kind: "instance-view", instanceId });
		},
		[setCurrentInstanceId],
	);

	const handleSelectAgent = useCallback(
		(agent: AggregateTopologyAgentItem): void => {
			setCurrentInstanceId(agent.instance_id);
			setPanel({ kind: "agent-view", agentNodeId: agent.node_id });
		},
		[setCurrentInstanceId],
	);

	const handleOpenConfig = useCallback(
		(instanceId: string): void => {
			setCurrentInstanceId(instanceId);
			const config = instanceConfigs.get(instanceId) ?? null;
			setEditingInstance(config);
		},
		[instanceConfigs, setCurrentInstanceId],
	);

	const handleCloseFormModal = useCallback((): void => {
		setEditingInstance(null);
	}, []);

	const handleFormSuccess = useCallback((): void => {
		setEditingInstance(null);
		void loadTopology();
		void loadInstanceConfigs();
	}, [loadInstanceConfigs, loadTopology]);

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

	const aggregate = topology;
	const instances = aggregate?.instances ?? [];
	const agents = aggregate?.agents ?? [];

	return (
		<div style={getContainerStyle(isMobile)}>
			<div style={headerStyle}>
				<div>
					<h1 style={titleStyle}>拓扑 workbench</h1>
					<p style={subtitleStyle}>
						关系与配置同屏单开；动作语义固定为 查看 / 进入 / 配置 / 关系。
					</p>
				</div>
				<div style={summaryGridStyle}>
					<SummaryCard
						label="聚合 freshness"
						value={aggregate ? formatFreshnessSummary(aggregate.freshness) : "未加载"}
					/>
					<SummaryCard
						label="request id"
						value={aggregate?.request_id ?? "未提供"}
					/>
					<SummaryCard
						label="诊断状态"
						value={aggregate?.partial_failure ? "部分降级" : "稳定"}
					/>
				</div>
			</div>

			<div style={getWorkbenchStyle(isMobile)}>
				<div style={stackStyle}>
					<section style={sectionCardStyle}>
						<div style={sectionHeaderStyle}>
							<h2 style={sectionTitleStyle}>实例关系</h2>
							<span style={sectionHintStyle}>
								以实例为配置入口，以 agent 为下钻出口。
							</span>
						</div>
						{instances.length === 0 ? (
							<p style={emptyInlineStyle}>当前没有实例拓扑。</p>
						) : (
							<div style={getNodeGridStyle(isMobile)}>
								{instances.map((instance) => {
									const relatedAgents =
										agentsByInstanceId.get(instance.instance_id) ?? [];
									const primaryAgent = primaryAgentByInstanceId.get(
										instance.instance_id,
									);
									const configEnabled = instanceConfigs.has(instance.instance_id);
									const diagnostic = diagnosticsByInstanceId.get(instance.instance_id);

									return (
										<article
											key={instance.node_id}
											style={getInstanceCardStyle(instance.status)}
										>
											<div style={cardHeaderStyle}>
												<div style={cardTitleBlockStyle}>
													<span style={cardTitleStyle}>{instance.name}</span>
													<span style={cardMetaStyle}>
														{instance.type} · {relatedAgents.length} agents
													</span>
												</div>
												<span style={getStatusBadgeStyle(instance.status === "active")}>{getInstanceStatusLabel(instance.status)}</span>
											</div>
											<p style={cardBodyTextStyle}>
												最后检查 {formatDateTime(instance.last_check_at)}
											</p>
											{diagnostic ? (
												<div style={instanceDiagnosticStyle}>
													<p style={cardSubTextStyle}>{getDiagnosticMessage(diagnostic)}</p>
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
															{diagnostic.error.next_step ? (
																<p style={cardSubTextStyle}>{diagnostic.error.next_step}</p>
															) : null}
														</>
													) : null}
												</div>
											) : null}
											<div style={actionsRowStyle}>
												<button
													type="button"
													style={secondaryButtonStyle}
													onClick={() => handleSelectInstance(instance.instance_id, "instance-view")}
													aria-label={`查看实例 ${instance.name}`}
												>
													查看
												</button>
												<DrilldownAction
													to={primaryAgent ? getCanonicalAgentPath(primaryAgent) : null}
													label="进入"
													ariaLabel={`进入实例 ${instance.name}`}
												/>
												<button
													type="button"
													style={configEnabled ? accentButtonStyle : disabledButtonStyle}
													onClick={configEnabled ? () => handleOpenConfig(instance.instance_id) : undefined}
													disabled={!configEnabled}
													aria-label={`配置实例 ${instance.name}`}
												>
													配置
												</button>
												<button
													type="button"
													style={secondaryButtonStyle}
													onClick={() => handleSelectInstance(instance.instance_id, "instance-relations")}
													aria-label={`关系实例 ${instance.name}`}
												>
													关系
												</button>
											</div>
										</article>
									);
								})}
							</div>
						)}
					</section>

					<section style={sectionCardStyle}>
						<div style={sectionHeaderStyle}>
							<h2 style={sectionTitleStyle}>代理关系</h2>
							<span style={sectionHintStyle}>只暴露可观察与可进入入口。</span>
						</div>
						{agents.length === 0 ? (
							<p style={emptyInlineStyle}>当前没有可下钻的 agent。</p>
						) : (
							<div style={getNodeGridStyle(isMobile)}>
								{agents.map((agent) => (
									<article key={agent.node_id} style={getAgentCardStyle(agent)}>
										<div style={cardHeaderStyle}>
											<div style={cardTitleBlockStyle}>
												<span style={cardTitleStyle}>{agent.agent_name}</span>
												<span style={cardMetaStyle}>{agent.instance_name}</span>
											</div>
											<span style={getStatusBadgeStyle(agent.status !== "error" && agent.is_active)}>
												{getAgentStatusLabel(agent)}
											</span>
										</div>
										<p style={cardBodyTextStyle}>
											最近活动 {formatDateTime(agent.last_active_at)}
										</p>
										<div style={actionsRowStyle}>
											<button
												type="button"
												style={secondaryButtonStyle}
												onClick={() => handleSelectAgent(agent)}
												aria-label={`查看 agent ${agent.agent_name}`}
											>
												查看
											</button>
											<DrilldownAction
												to={getCanonicalAgentPath(agent)}
												label="进入"
												ariaLabel={`进入 agent ${agent.agent_name}`}
											/>
											<button
												type="button"
												style={secondaryButtonStyle}
												onClick={() => handleSelectInstance(agent.instance_id, "instance-relations")}
												aria-label={`关系 agent ${agent.agent_name}`}
											>
												关系
											</button>
										</div>
									</article>
								))}
							</div>
						)}
					</section>

					<div style={getMetadataGridStyle(isMobile)}>
						<MetadataSection
							title="技能关系"
							emptyLabel="未暴露技能数据"
							items={aggregate?.skills ?? []}
							fallbackPrefix="skill"
						/>
						<MetadataSection
							title="外接 ACP"
							emptyLabel="未暴露外接 ACP"
							items={aggregate?.external_acps ?? []}
							fallbackPrefix="acp"
						/>
					</div>
				</div>

				<aside style={panelStyle}>
					{renderWorkbenchPanel({
						panel,
						topology: aggregate,
						diagnosticsByInstanceId,
						agentsByInstanceId,
						agentsByNodeId,
						instanceConfigs,
						onOpenConfig: handleOpenConfig,
					})}
				</aside>
			</div>

			{editingInstance ? (
				<InstanceFormModal
					instance={editingInstance}
					onClose={handleCloseFormModal}
					onSuccess={handleFormSuccess}
				/>
			) : null}
		</div>
	);
}

function renderWorkbenchPanel({
	panel,
	topology,
	diagnosticsByInstanceId,
	agentsByInstanceId,
	agentsByNodeId,
	instanceConfigs,
	onOpenConfig,
}: {
	panel: WorkbenchPanel | null;
	topology: AggregateTopologyResponse | null;
	diagnosticsByInstanceId: Map<string, AggregateInstanceDiagnostic>;
	agentsByInstanceId: Map<string, AggregateTopologyAgentItem[]>;
	agentsByNodeId: Map<string, AggregateTopologyAgentItem>;
	instanceConfigs: Map<string, InstanceItem>;
	onOpenConfig: (instanceId: string) => void;
}): JSX.Element {
	if (!topology || !panel) {
		return (
			<div style={panelCardStyle}>
				<p style={emptyInlineStyle}>选择一个节点查看关系与配置上下文。</p>
			</div>
		);
	}

	if (panel.kind === "instance-view") {
		const instance = topology.instances.find(
			(item) => item.instance_id === panel.instanceId,
		);
		if (!instance) {
			return <div style={panelCardStyle}>实例已不存在。</div>;
		}

		const primaryAgent = (agentsByInstanceId.get(instance.instance_id) ?? [])[0] ?? null;
		const diagnostic = diagnosticsByInstanceId.get(instance.instance_id) ?? null;
		const config = instanceConfigs.get(instance.instance_id) ?? null;

		return (
			<div style={panelCardStyle}>
				<h2 style={panelTitleStyle}>查看 · {instance.name}</h2>
				<div style={panelInfoListStyle}>
					<InfoRow label="类型" value={instance.type} />
					<InfoRow label="状态" value={getInstanceStatusLabel(instance.status)} />
					<InfoRow label="最后检查" value={formatDateTime(instance.last_check_at)} />
					<InfoRow label="创建时间" value={formatDateTime(instance.created_at)} />
					<InfoRow
						label="配置端点"
						value={config?.endpoint ?? "配置上下文未同步到拓扑"}
					/>
				</div>
				{diagnostic ? (
					<div style={noteBoxStyle}>
						<strong style={noteTitleStyle}>实例诊断</strong>
						<p style={noteBodyStyle}>{getDiagnosticMessage(diagnostic)}</p>
						<p style={noteHintStyle}>
							checked_at · {diagnostic.freshness.checked_at ?? "未提供"}
						</p>
						{diagnostic.error ? (
							<>
								<p style={noteHintStyle}>code · {diagnostic.error.code}</p>
								<p style={noteHintStyle}>request_id · {diagnostic.error.request_id}</p>
								<p style={noteHintStyle}>
									recoverable · {String(diagnostic.error.recoverable)}
								</p>
							</>
						) : null}
						{diagnostic.error?.next_step ? (
							<p style={noteHintStyle}>{diagnostic.error.next_step}</p>
						) : null}
					</div>
				) : null}
				<div style={panelActionsStyle}>
					<DrilldownAction
						to={primaryAgent ? getCanonicalAgentPath(primaryAgent) : null}
						label="进入"
						ariaLabel={`进入实例 ${instance.name}`}
					/>
					<button
						type="button"
						style={config ? accentButtonStyle : disabledButtonStyle}
						onClick={config ? () => onOpenConfig(instance.instance_id) : undefined}
						disabled={!config}
					>
						配置
					</button>
				</div>
			</div>
		);
	}

	if (panel.kind === "instance-relations") {
		const instance = topology.instances.find(
			(item) => item.instance_id === panel.instanceId,
		);
		if (!instance) {
			return <div style={panelCardStyle}>实例已不存在。</div>;
		}

		const relatedAgents = agentsByInstanceId.get(instance.instance_id) ?? [];

		return (
			<div style={panelCardStyle}>
				<h2 style={panelTitleStyle}>关系 · {instance.name}</h2>
				<p style={panelLeadStyle}>
					当前实例关联 {relatedAgents.length} 个 agent，skills / ACP 另见左侧独立区块。
				</p>
				{relatedAgents.length === 0 ? (
					<p style={emptyInlineStyle}>当前实例暂未暴露 agent，进入动作已禁用。</p>
				) : (
					<div style={relationListStyle}>
						{relatedAgents.map((agent) => (
							<div key={agent.node_id} style={relationItemStyle}>
								<div>
									<strong style={relationTitleStyle}>{agent.agent_name}</strong>
									<p style={relationMetaStyle}>{getAgentStatusLabel(agent)}</p>
								</div>
								<DrilldownAction
									to={getCanonicalAgentPath(agent)}
									label="进入"
									ariaLabel={`进入 agent ${agent.agent_name}`}
								/>
							</div>
						))}
					</div>
				)}
			</div>
		);
	}

	const agent = agentsByNodeId.get(panel.agentNodeId);
	if (!agent) {
		return <div style={panelCardStyle}>agent 已不存在。</div>;
	}

	return (
		<div style={panelCardStyle}>
			<h2 style={panelTitleStyle}>查看 · {agent.agent_name}</h2>
			<div style={panelInfoListStyle}>
				<InfoRow label="所属实例" value={agent.instance_name} />
				<InfoRow label="状态" value={getAgentStatusLabel(agent)} />
				<InfoRow label="最近活动" value={formatDateTime(agent.last_active_at)} />
				<InfoRow label="session 路径" value={getCanonicalAgentPath(agent)} />
			</div>
			<div style={noteBoxStyle}>
				<strong style={noteTitleStyle}>关系语义</strong>
				<p style={noteBodyStyle}>当前 agent 由实例节点托管，可继续进入单 agent 会话。</p>
			</div>
			<div style={panelActionsStyle}>
				<DrilldownAction
					to={getCanonicalAgentPath(agent)}
					label="进入"
					ariaLabel={`进入 agent ${agent.agent_name}`}
				/>
			</div>
		</div>
	);
}

function DrilldownAction({
	to,
	label,
	ariaLabel,
}: {
	to: string | null;
	label: string;
	ariaLabel: string;
}): JSX.Element {
	if (!to) {
		return (
			<button
				type="button"
				style={disabledButtonStyle}
				disabled
				aria-label={ariaLabel}
			>
				{label}
			</button>
		);
	}

	return (
		<Link to={to} style={primaryLinkStyle} aria-label={ariaLabel}>
			{label}
		</Link>
	);
}

function SummaryCard({ label, value }: { label: string; value: string }): JSX.Element {
	return (
		<div style={summaryCardStyle}>
			<span style={summaryLabelStyle}>{label}</span>
			<strong style={summaryValueStyle}>{value}</strong>
		</div>
	);
}

function MetadataSection({
	title,
	emptyLabel,
	items,
	fallbackPrefix,
}: {
	title: string;
	emptyLabel: string;
	items: Array<AggregateTopologySkillItem | AggregateTopologyExternalAcpItem>;
	fallbackPrefix: string;
}): JSX.Element {
	return (
		<section style={sectionCardStyle}>
			<div style={sectionHeaderStyle}>
				<h2 style={sectionTitleStyle}>{title}</h2>
				<span style={sectionHintStyle}>无数据时显式空态，不伪造节点。</span>
			</div>
			{items.length === 0 ? (
				<div style={emptyMetadataStyle}>{emptyLabel}</div>
			) : (
				<div style={metadataListStyle}>
					{items.map((item, index) => {
						const label = getTopologyItemLabel(item, fallbackPrefix, index);
						const key = buildNodeKey(item.node_id ?? item.id, fallbackPrefix, index);
						return (
							<div key={key} style={metadataItemStyle}>
								<strong style={relationTitleStyle}>{label}</strong>
							</div>
						);
					})}
				</div>
			)}
		</section>
	);
}

function InfoRow({ label, value }: { label: string; value: string }): JSX.Element {
	return (
		<div style={infoRowStyle}>
			<span style={infoLabelStyle}>{label}</span>
			<span style={infoValueStyle}>{value}</span>
		</div>
	);
}

function getContainerStyle(isMobile: boolean): React.CSSProperties {
	return {
		height: "100%",
		padding: isMobile ? "1rem" : "2rem",
		background:
			"radial-gradient(circle at top left, rgba(210, 179, 120, 0.18), transparent 32%), #f4f1ea",
		color: "#1f2933",
		fontFamily:
			'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
		overflow: "auto",
		boxSizing: "border-box",
	};
}

function getWorkbenchStyle(isMobile: boolean): React.CSSProperties {
	return {
		display: "grid",
		gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.7fr) minmax(320px, 0.9fr)",
		gap: "1rem",
		alignItems: "start",
	};
}

function getNodeGridStyle(isMobile: boolean): React.CSSProperties {
	return {
		display: "grid",
		gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(260px, 1fr))",
		gap: "0.875rem",
	};
}

function getMetadataGridStyle(isMobile: boolean): React.CSSProperties {
	return {
		display: "grid",
		gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
		gap: "1rem",
	};
}

function getInstanceCardStyle(status: string): React.CSSProperties {
	const active = status === "active";
	return {
		background: "rgba(255, 255, 255, 0.92)",
		border: `1px solid ${active ? "#c9984c" : "#d7d2c8"}`,
		borderRadius: "1rem",
		padding: "1rem",
		display: "flex",
		flexDirection: "column",
		gap: "0.75rem",
		boxShadow: active ? "0 18px 32px rgba(102, 76, 32, 0.08)" : "none",
	};
}

function getAgentCardStyle(agent: AggregateTopologyAgentItem): React.CSSProperties {
	const highlight = agent.status === "error" || !agent.is_active;
	return {
		background: "rgba(255, 255, 255, 0.88)",
		border: `1px solid ${highlight ? "#d9a55a" : "#d7d2c8"}`,
		borderRadius: "1rem",
		padding: "1rem",
		display: "flex",
		flexDirection: "column",
		gap: "0.75rem",
	};
}

function getStatusBadgeStyle(isHealthy: boolean): React.CSSProperties {
	return {
		fontSize: "0.75rem",
		padding: "0.2rem 0.6rem",
		borderRadius: "999px",
		background: isHealthy ? "#ecfdf5" : "#fff7ed",
		color: isHealthy ? "#166534" : "#9a3412",
		fontWeight: 700,
		whiteSpace: "nowrap",
	};
}

const headerStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "1rem",
	marginBottom: "1rem",
};

const titleStyle: React.CSSProperties = {
	fontSize: "1.6rem",
	fontWeight: 700,
	margin: 0,
	color: "#1f2933",
};

const subtitleStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.9rem",
	color: "#6b7280",
};

const summaryGridStyle: React.CSSProperties = {
	display: "grid",
	gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
	gap: "0.75rem",
};

const summaryCardStyle: React.CSSProperties = {
	background: "rgba(255, 255, 255, 0.76)",
	border: "1px solid #d7d2c8",
	borderRadius: "0.9rem",
	padding: "0.85rem 1rem",
	display: "flex",
	flexDirection: "column",
	gap: "0.35rem",
};

const summaryLabelStyle: React.CSSProperties = {
	fontSize: "0.75rem",
	letterSpacing: "0.05em",
	textTransform: "uppercase",
	color: "#6b7280",
};

const summaryValueStyle: React.CSSProperties = {
	fontSize: "0.95rem",
	fontWeight: 700,
	wordBreak: "break-word",
};

const stackStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "1rem",
};

const sectionCardStyle: React.CSSProperties = {
	background: "rgba(255, 255, 255, 0.72)",
	border: "1px solid #d7d2c8",
	borderRadius: "1rem",
	padding: "1rem",
	display: "flex",
	flexDirection: "column",
	gap: "0.9rem",
};

const sectionHeaderStyle: React.CSSProperties = {
	display: "flex",
	justifyContent: "space-between",
	alignItems: "baseline",
	gap: "0.75rem",
	flexWrap: "wrap",
};

const sectionTitleStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "1rem",
	fontWeight: 700,
	color: "#1f2933",
};

const sectionHintStyle: React.CSSProperties = {
	fontSize: "0.75rem",
	color: "#6b7280",
};

const cardHeaderStyle: React.CSSProperties = {
	display: "flex",
	justifyContent: "space-between",
	alignItems: "flex-start",
	gap: "0.75rem",
};

const cardTitleBlockStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "0.25rem",
	minWidth: 0,
};

const cardTitleStyle: React.CSSProperties = {
	fontSize: "1rem",
	fontWeight: 700,
	color: "#1f2933",
};

const cardMetaStyle: React.CSSProperties = {
	fontSize: "0.8rem",
	color: "#6b7280",
};

const cardBodyTextStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.85rem",
	color: "#1f2933",
};

const cardSubTextStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.8rem",
	color: "#6b7280",
};

const instanceDiagnosticStyle: React.CSSProperties = {
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

const actionsRowStyle: React.CSSProperties = {
	display: "flex",
	flexWrap: "wrap",
	gap: "0.5rem",
};

const baseActionStyle: React.CSSProperties = {
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	padding: "0.48rem 0.9rem",
	borderRadius: "999px",
	fontSize: "0.82rem",
	fontWeight: 600,
	textDecoration: "none",
	border: "1px solid transparent",
	cursor: "pointer",
	background: "transparent",
};

const primaryLinkStyle: React.CSSProperties = {
	...baseActionStyle,
	background: "#1f2933",
	color: "#fff",
};

const secondaryButtonStyle: React.CSSProperties = {
	...baseActionStyle,
	background: "#fff",
	color: "#1f2933",
	border: "1px solid #d7d2c8",
};

const accentButtonStyle: React.CSSProperties = {
	...baseActionStyle,
	background: "#c9984c",
	color: "#fff",
};

const disabledButtonStyle: React.CSSProperties = {
	...baseActionStyle,
	background: "#f3f4f6",
	color: "#9ca3af",
	border: "1px solid #e5e7eb",
	cursor: "not-allowed",
};

const panelStyle: React.CSSProperties = {
	position: "sticky",
	top: 0,
};

const panelCardStyle: React.CSSProperties = {
	background: "rgba(255, 255, 255, 0.92)",
	border: "1px solid #d7d2c8",
	borderRadius: "1rem",
	padding: "1rem",
	display: "flex",
	flexDirection: "column",
	gap: "0.9rem",
	minHeight: "220px",
};

const panelTitleStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "1.05rem",
	fontWeight: 700,
	color: "#1f2933",
};

const panelLeadStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.85rem",
	color: "#6b7280",
};

const panelInfoListStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "0.4rem",
};

const infoRowStyle: React.CSSProperties = {
	display: "flex",
	justifyContent: "space-between",
	gap: "1rem",
	paddingBottom: "0.45rem",
	borderBottom: "1px solid #f1ede6",
};

const infoLabelStyle: React.CSSProperties = {
	fontSize: "0.8rem",
	color: "#6b7280",
};

const infoValueStyle: React.CSSProperties = {
	fontSize: "0.85rem",
	color: "#1f2933",
	fontWeight: 600,
	textAlign: "right",
	wordBreak: "break-word",
};

const noteBoxStyle: React.CSSProperties = {
	padding: "0.9rem",
	borderRadius: "0.9rem",
	background: "#f8f3e9",
	border: "1px solid #ead8b8",
	display: "flex",
	flexDirection: "column",
	gap: "0.35rem",
};

const noteTitleStyle: React.CSSProperties = {
	fontSize: "0.8rem",
	color: "#6a4f2a",
};

const noteBodyStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.85rem",
	color: "#1f2933",
};

const noteHintStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.8rem",
	color: "#6b7280",
};

const panelActionsStyle: React.CSSProperties = {
	display: "flex",
	flexWrap: "wrap",
	gap: "0.5rem",
};

const relationListStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "0.75rem",
};

const relationItemStyle: React.CSSProperties = {
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	gap: "0.75rem",
	padding: "0.75rem 0.85rem",
	borderRadius: "0.85rem",
	background: "#fbfaf7",
	border: "1px solid #ebe6db",
};

const relationTitleStyle: React.CSSProperties = {
	fontSize: "0.9rem",
	color: "#1f2933",
};

const relationMetaStyle: React.CSSProperties = {
	margin: "0.2rem 0 0 0",
	fontSize: "0.8rem",
	color: "#6b7280",
};

const metadataListStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "0.6rem",
};

const metadataItemStyle: React.CSSProperties = {
	padding: "0.75rem 0.85rem",
	borderRadius: "0.85rem",
	background: "#fbfaf7",
	border: "1px solid #ebe6db",
};

const emptyMetadataStyle: React.CSSProperties = {
	padding: "1rem",
	borderRadius: "0.85rem",
	background: "#faf7f0",
	border: "1px dashed #d7d2c8",
	fontSize: "0.85rem",
	color: "#6b7280",
};

const emptyInlineStyle: React.CSSProperties = {
	margin: 0,
	fontSize: "0.85rem",
	color: "#6b7280",
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
