import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { listInstances } from "../api/instanceClient";
import type { InstanceItem } from "../api/types";
import { setStoredCurrentInstanceId } from "../hooks/useCurrentInstance";
import { useIsMobile } from "../hooks/useIsMobile";
import { AgentWorkspace } from "./AgentWorkspace";
import { InstanceList } from "./InstanceList";

const LEFT_PANEL_WIDTH = 280;
const DEFAULT_SESSION_AGENT_ID = "main";

export function buildCanonicalSessionPath(
	instanceId: string,
	agentId = DEFAULT_SESSION_AGENT_ID,
	search = "",
): string {
	return `/session/${encodeURIComponent(instanceId)}/${encodeURIComponent(agentId)}${search}`;
}

export default function SessionPage(): JSX.Element {
	const { instanceId, agentId } = useParams<{
		instanceId?: string;
		agentId?: string;
	}>();
	const location = useLocation();
	const navigate = useNavigate();
	const isMobile = useIsMobile();
	const [instances, setInstances] = useState<InstanceItem[]>([]);
	const [instancesLoading, setInstancesLoading] = useState(false);
	const [instancesError, setInstancesError] = useState<string | null>(null);
	const selectedInstanceId = instanceId ?? null;
	const selectedAgentId = agentId ?? null;
	const getCanonicalSessionPath = useCallback(
		(nextInstanceId: string, nextAgentId = DEFAULT_SESSION_AGENT_ID): string =>
			buildCanonicalSessionPath(nextInstanceId, nextAgentId, location.search),
		[location.search],
	);
	const hasCanonicalSessionRoute = Boolean(
		selectedInstanceId && selectedAgentId,
	);

	useEffect(() => {
		setInstancesLoading(true);
		setInstancesError(null);
		listInstances()
			.then((data) => {
				setInstances(data);
			})
			.catch((error: unknown) => {
				const errorMessage =
					error instanceof Error && error.message
						? error.message
						: "获取实例列表失败";
				setInstancesError(errorMessage);
				setInstances([]);
			})
			.finally(() => setInstancesLoading(false));
	}, []);

	useEffect(() => {
		if (selectedInstanceId && !selectedAgentId) {
			navigate(getCanonicalSessionPath(selectedInstanceId), { replace: true });
		}
	}, [getCanonicalSessionPath, navigate, selectedAgentId, selectedInstanceId]);

	useEffect(() => {
		if (!selectedInstanceId) return;
		setStoredCurrentInstanceId(selectedInstanceId);
	}, [selectedInstanceId]);

	const handleSelectInstance = (id: string): void => {
		setStoredCurrentInstanceId(id);
		navigate(getCanonicalSessionPath(id));
	};

	const handleMobileSelect = (
		e: React.ChangeEvent<HTMLSelectElement>,
	): void => {
		const selectedId = e.target.value;
		if (selectedId) {
			setStoredCurrentInstanceId(selectedId);
			navigate(getCanonicalSessionPath(selectedId));
		}
	};

	const selectedInstance = instances.find((i) => i.id === selectedInstanceId);

	if (isMobile) {
		return (
			<div style={mobileContainerStyle}>
				<div style={mobileHeaderStyle}>
					<select
						value={selectedInstanceId ?? ""}
						onChange={handleMobileSelect}
						style={mobileSelectStyle}
						disabled={instancesLoading}
					>
						<option value="">
							{instancesLoading
								? "加载中..."
								: instancesError
									? "加载失败"
									: "选择实例"}
						</option>
						{instances.map((instance) => (
							<option key={instance.id} value={instance.id}>
								{instance.name}
							</option>
						))}
					</select>
					{selectedInstance && (
						<span style={mobileStatusStyle}>
							{selectedInstance.status === "connected"
								? "● 已连接"
								: `○ ${selectedInstance.status}`}
						</span>
					)}
				</div>
				{hasCanonicalSessionRoute ? (
					<AgentWorkspace
						key={`${selectedInstanceId}:${selectedAgentId}`}
						instanceId={selectedInstanceId ?? undefined}
						agentId={selectedAgentId ?? undefined}
					/>
				) : (
					<div style={mobilePlaceholderStyle}>
						<span style={mobilePlaceholderTextStyle}>
							请选择一个实例开始对话
						</span>
					</div>
				)}
			</div>
		);
	}

	return (
		<div style={getContainerStyle()}>
			<div style={getLayoutStyle()}>
				<div style={getLeftPanelStyle()}>
					<InstanceList
						instances={instances}
						loading={instancesLoading}
						error={instancesError}
						selectedInstanceId={selectedInstanceId}
						onSelectInstance={handleSelectInstance}
					/>
				</div>
				<div style={getRightPanelStyle()}>
					{hasCanonicalSessionRoute ? (
						<AgentWorkspace
							key={`${selectedInstanceId}:${selectedAgentId}`}
							instanceId={selectedInstanceId ?? undefined}
							agentId={selectedAgentId ?? undefined}
						/>
					) : (
						<div style={placeholderStyle}>
							<span style={placeholderTextStyle}>选择一个实例开始对话</span>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

const mobileContainerStyle: React.CSSProperties = {
	height: "100%",
	display: "flex",
	flexDirection: "column",
	background: "#fff",
};

const mobileHeaderStyle: React.CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: "0.75rem",
	padding: "0.5rem 0.75rem",
	background: "#fff",
	borderBottom: "1px solid #e5e7eb",
};

const mobileSelectStyle: React.CSSProperties = {
	flex: 1,
	padding: "0.5rem 0.75rem",
	fontSize: "0.9375rem",
	fontWeight: 500,
	borderRadius: "0.375rem",
	border: "1px solid #d1d5db",
	background: "#fff",
	color: "#1f2933",
};

const mobileStatusStyle: React.CSSProperties = {
	fontSize: "0.75rem",
	color: "#6b7280",
};

const mobilePlaceholderStyle: React.CSSProperties = {
	flex: 1,
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	background: "#f9fafb",
};

const mobilePlaceholderTextStyle: React.CSSProperties = {
	fontSize: "1rem",
	fontWeight: 500,
	color: "#9ca3af",
};

const placeholderStyle: React.CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	height: "100%",
	width: "100%",
	background: "#f9fafb",
};

const placeholderTextStyle: React.CSSProperties = {
	fontSize: "1.125rem",
	fontWeight: 500,
	color: "#9ca3af",
};

function getContainerStyle(): React.CSSProperties {
	return {
		height: "100%",
		display: "flex",
		flexDirection: "column",
		background: "#f4f1ea",
		color: "#1f2933",
		fontFamily:
			'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
	};
}

function getLayoutStyle(): React.CSSProperties {
	return {
		display: "flex",
		flexDirection: "row",
		flex: 1,
		overflow: "hidden",
	};
}

function getLeftPanelStyle(): React.CSSProperties {
	return {
		width: `${LEFT_PANEL_WIDTH}px`,
		minWidth: `${LEFT_PANEL_WIDTH}px`,
		borderRight: "1px solid #e5e7eb",
		background: "#f9fafb",
		flexShrink: 0,
		overflow: "hidden",
	};
}

function getRightPanelStyle(): React.CSSProperties {
	return {
		flex: 1,
		height: "100%",
		overflow: "hidden",
		display: "flex",
		flexDirection: "column",
	};
}
