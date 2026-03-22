import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { listInstances } from "../api/instanceClient";
import type { InstanceItem } from "../api/types";
import { setStoredCurrentInstanceId } from "../hooks/useCurrentInstance";
import { useIsMobile } from "../hooks/useIsMobile";
import { AgentWorkspace } from "./AgentWorkspace";

const DEFAULT_SESSION_AGENT_ID = "main";
const DESKTOP_MAX_WIDTH = 880;

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

	const selectedInstance = instances.find((i) => i.id === selectedInstanceId);

	// Auto-redirect if on /session without instance and we have instances
	useEffect(() => {
		if (
			!selectedInstanceId &&
			!instancesLoading &&
			!instancesError &&
			instances.length > 0
		) {
			// Redirect to first instance
			navigate(getCanonicalSessionPath(instances[0].id), { replace: true });
		}
	}, [selectedInstanceId, instancesLoading, instancesError, instances, navigate, getCanonicalSessionPath]);

	// Mobile: compact header with instance selector
	if (isMobile) {
		return (
			<div style={mobileContainerStyle}>
				<header style={mobileHeaderStyle}>
					<h1 style={mobileTitleStyle}>会话</h1>
					{selectedInstance && (
						<span style={mobileStatusStyle}>
							{selectedInstance.status === "connected"
								? "● 已连接"
								: `○ ${selectedInstance.status}`}
						</span>
					)}
				</header>
				{hasCanonicalSessionRoute ? (
					<AgentWorkspace
						key={`${selectedInstanceId}:${selectedAgentId}`}
						instanceId={selectedInstanceId ?? undefined}
						agentId={selectedAgentId ?? undefined}
					/>
				) : instancesLoading ? (
					<div style={centeredMessageStyle}>
						<span style={textSecondaryStyle}>加载中...</span>
					</div>
				) : instancesError ? (
					<div style={centeredMessageStyle}>
						<span style={textErrorStyle}>错误: {instancesError}</span>
					</div>
				) : instances.length === 0 ? (
					<div style={centeredMessageStyle}>
						<span style={textSecondaryStyle}>暂无实例</span>
					</div>
				) : null}
			</div>
		);
	}

	// Desktop: minimal three-zone shell with max-width centering
	return (
		<div style={desktopContainerStyle}>
			<header style={desktopHeaderStyle}>
				<div style={getDesktopHeaderInnerStyle(isMobile)}>
					<h1 style={desktopTitleStyle}>
						{selectedInstance?.name ?? "会话"}
					</h1>
					{selectedInstance && (
						<span style={desktopStatusStyle}>
							{selectedInstance.status === "connected"
								? "● 已连接"
								: `○ ${selectedInstance.status}`}
						</span>
					)}
				</div>
			</header>
			<main style={desktopMainStyle}>
				<div style={desktopCenterWrapperStyle}>
					{hasCanonicalSessionRoute ? (
						<AgentWorkspace
							key={`${selectedInstanceId}:${selectedAgentId}`}
							instanceId={selectedInstanceId ?? undefined}
							agentId={selectedAgentId ?? undefined}
						/>
					) : instancesLoading ? (
						<div style={centeredMessageStyle}>
							<span style={textSecondaryStyle}>加载中...</span>
						</div>
					) : instancesError ? (
						<div style={centeredMessageStyle}>
							<span style={textErrorStyle}>错误: {instancesError}</span>
						</div>
					) : instances.length === 0 ? (
						<div style={centeredMessageStyle}>
							<span style={textSecondaryStyle}>暂无实例</span>
						</div>
					) : (
						<div style={centeredMessageStyle}>
							<span style={textSecondaryStyle}>选择实例开始对话</span>
						</div>
					)}
				</div>
			</main>
		</div>
	);
}

// === Mobile Styles ===
const mobileContainerStyle: React.CSSProperties = {
	height: "100%",
	display: "flex",
	flexDirection: "column",
	background: "#fff",
};

const mobileHeaderStyle: React.CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	gap: "0.75rem",
	padding: "0.625rem 0.875rem",
	background: "#fff",
	borderBottom: "1px solid #e5e7eb",
	flexShrink: 0,
};

const mobileTitleStyle: React.CSSProperties = {
	fontSize: "1.125rem",
	fontWeight: 600,
	color: "#111827",
	margin: 0,
};

const mobileStatusStyle: React.CSSProperties = {
	fontSize: "0.75rem",
	color: "#6b7280",
};

// === Desktop Styles ===
const desktopContainerStyle: React.CSSProperties = {
	height: "100%",
	display: "flex",
	flexDirection: "column",
	background: "#f8fafc",
	color: "#1f2933",
	fontFamily:
		'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
};

const desktopHeaderStyle: React.CSSProperties = {
	display: "flex",
	justifyContent: "center",
	background: "#fff",
	borderBottom: "1px solid #e5e7eb",
	flexShrink: 0,
};

const desktopTitleStyle: React.CSSProperties = {
	fontSize: "1.25rem",
	fontWeight: 600,
	color: "#111827",
	margin: 0,
};

const desktopStatusStyle: React.CSSProperties = {
	fontSize: "0.8125rem",
	color: "#6b7280",
};

const desktopMainStyle: React.CSSProperties = {
	flex: 1,
	display: "flex",
	justifyContent: "center",
	overflow: "hidden",
	minHeight: 0,
};

const desktopCenterWrapperStyle: React.CSSProperties = {
	width: "100%",
	maxWidth: `${DESKTOP_MAX_WIDTH}px`,
	height: "100%",
	display: "flex",
	flexDirection: "column",
};

function getDesktopHeaderInnerStyle(_isMobile: boolean): React.CSSProperties {
	return {
		width: "100%",
		maxWidth: `${DESKTOP_MAX_WIDTH}px`,
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: "0.75rem",
		padding: "0.75rem 1rem",
	};
}

// === Shared Styles ===
const centeredMessageStyle: React.CSSProperties = {
	flex: 1,
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	padding: "2rem",
};

const textSecondaryStyle: React.CSSProperties = {
	fontSize: "0.9375rem",
	fontWeight: 500,
	color: "#9ca3af",
};

const textErrorStyle: React.CSSProperties = {
	fontSize: "0.9375rem",
	fontWeight: 500,
	color: "#dc2626",
};