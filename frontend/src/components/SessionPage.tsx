import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { listInstances } from "../api/instanceClient";
import type { InstanceItem } from "../api/types";
import {
	getStoredCurrentInstanceId,
	setStoredCurrentInstanceId,
} from "../hooks/useCurrentInstance";
import { useIsMobile } from "../hooks/useIsMobile";
import { AgentWorkspace } from "./AgentWorkspace";

const DEFAULT_SESSION_AGENT_ID = "main";
const DESKTOP_MAX_WIDTH = 880;
const RESERVED_NONE_CHANNEL_KEY = "__none__";
const RESERVED_NEW_SESSION_KEY = "__new__";
const INSTANCE_ID_QUERY_KEY = "instanceId";
const PREFERRED_SESSION_QUERY_KEY = "session";

function normalizeSearch(search: string): string {
	if (!search) return "";
	return search.startsWith("?") ? search.slice(1) : search;
}

export function getPreferredSessionKeyFromSearch(search: string): string | null {
	const params = new URLSearchParams(normalizeSearch(search));
	return params.get(PREFERRED_SESSION_QUERY_KEY);
}

function getInstanceIdFromSearch(search: string): string | null {
	const params = new URLSearchParams(normalizeSearch(search));
	return params.get(INSTANCE_ID_QUERY_KEY);
}

export function resolveSessionPageInstanceId({
	search,
	legacyInstanceId,
	storedInstanceId,
}: {
	search: string;
	legacyInstanceId?: string | null;
	storedInstanceId?: string | null;
}): string | null {
	return (
		normalizeNonEmpty(getInstanceIdFromSearch(search)) ??
		normalizeNonEmpty(legacyInstanceId) ??
		normalizeNonEmpty(storedInstanceId)
	);
}

function normalizeNonEmpty(value: string | null | undefined): string | null {
	if (typeof value !== "string") return null;
	const normalizedValue = value.trim();
	return normalizedValue.length > 0 ? normalizedValue : null;
}

function deriveChannelKeyFromSessionKey(sessionKey: string | null): string | null {
	const normalizedSessionKey = normalizeNonEmpty(sessionKey);
	if (!normalizedSessionKey) return null;
	const delimiterIndex = normalizedSessionKey.indexOf(":");
	if (delimiterIndex <= 0) return null;
	return normalizedSessionKey.slice(0, delimiterIndex);
}

export function buildSessionEntryPath({
	instanceId,
	agentId = DEFAULT_SESSION_AGENT_ID,
	search = "",
	preferredSessionKey = null,
	channelKey = null,
}: {
	instanceId?: string | null;
	agentId?: string;
	search?: string;
	preferredSessionKey?: string | null;
	channelKey?: string | null;
}): string {
	const params = new URLSearchParams(normalizeSearch(search));
	const normalizedInstanceId = normalizeNonEmpty(instanceId);
	if (normalizedInstanceId) {
		params.set(INSTANCE_ID_QUERY_KEY, normalizedInstanceId);
	} else {
		params.delete(INSTANCE_ID_QUERY_KEY);
	}

	const normalizedPreferredSessionKey = normalizeNonEmpty(preferredSessionKey);
	const resolvedChannelKey =
		deriveChannelKeyFromSessionKey(normalizedPreferredSessionKey) ??
		normalizeNonEmpty(channelKey);

	if (normalizedPreferredSessionKey && !resolvedChannelKey) {
		params.set(PREFERRED_SESSION_QUERY_KEY, normalizedPreferredSessionKey);
	} else {
		params.delete(PREFERRED_SESSION_QUERY_KEY);
	}

	const nextSearch = params.toString();
	if (normalizedPreferredSessionKey && resolvedChannelKey) {
		return buildCanonicalSessionPath(
			agentId,
			resolvedChannelKey,
			normalizedPreferredSessionKey,
			nextSearch ? `?${nextSearch}` : "",
		);
	}

	if (resolvedChannelKey) {
		return buildCanonicalSessionPath(
			agentId,
			resolvedChannelKey,
			RESERVED_NEW_SESSION_KEY,
			nextSearch ? `?${nextSearch}` : "",
		);
	}

	return buildCanonicalSessionPath(
		agentId,
		RESERVED_NONE_CHANNEL_KEY,
		RESERVED_NEW_SESSION_KEY,
		nextSearch ? `?${nextSearch}` : "",
	);
}

export function buildCanonicalSessionPath(
	agentId = DEFAULT_SESSION_AGENT_ID,
	channelKey = RESERVED_NONE_CHANNEL_KEY,
	sessionKey = RESERVED_NEW_SESSION_KEY,
	search = "",
): string {
	return `/session/${encodeURIComponent(agentId)}/${encodeURIComponent(channelKey)}/${encodeURIComponent(sessionKey)}${search}`;
}

export default function SessionPage(): JSX.Element {
	const { instanceId, agentId, channelKey, sessionKey } = useParams<{
		instanceId?: string;
		agentId?: string;
		channelKey?: string;
		sessionKey?: string;
	}>();
	const location = useLocation();
	const navigate = useNavigate();
	const isMobile = useIsMobile();
	const [instances, setInstances] = useState<InstanceItem[]>([]);
	const [instancesLoading, setInstancesLoading] = useState(false);
	const [instancesError, setInstancesError] = useState<string | null>(null);
	const isCanonicalSessionRoute = Boolean(agentId && channelKey && sessionKey);
	const legacyInstanceId = isCanonicalSessionRoute ? null : instanceId ?? null;
	const storedInstanceId = getStoredCurrentInstanceId();
	const selectedInstanceId = resolveSessionPageInstanceId({
		search: location.search,
		legacyInstanceId,
		storedInstanceId,
	});
	const selectedAgentId = agentId ?? null;
	const selectedChannelKey = channelKey ?? null;
	const selectedSessionKey = sessionKey ?? null;
	const preferredSessionKeyFromSearch = getPreferredSessionKeyFromSearch(location.search);
	const preferredSessionKey =
		selectedSessionKey && selectedSessionKey !== RESERVED_NEW_SESSION_KEY
			? selectedSessionKey
			: preferredSessionKeyFromSearch;
	const getCanonicalSessionPath = useCallback(
		(nextInstanceId: string, nextAgentId = DEFAULT_SESSION_AGENT_ID): string =>
			buildSessionEntryPath({
				instanceId: nextInstanceId,
				agentId: nextAgentId,
				search: location.search,
			}),
		[location.search],
	);
	const hasCanonicalSessionRoute = Boolean(
		selectedAgentId && selectedChannelKey && selectedSessionKey,
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
		if (legacyInstanceId && selectedAgentId && !selectedChannelKey && !selectedSessionKey) {
			navigate(
				buildSessionEntryPath({
					instanceId: legacyInstanceId,
					agentId: selectedAgentId,
					preferredSessionKey,
					search: location.search,
				}),
				{ replace: true },
			);
			return;
		}

		if (legacyInstanceId && !selectedAgentId) {
			navigate(
				buildSessionEntryPath({
					instanceId: legacyInstanceId,
					search: location.search,
				}),
				{ replace: true },
			);
		}
	}, [
		legacyInstanceId,
		location.search,
		navigate,
		preferredSessionKey,
		selectedAgentId,
		selectedChannelKey,
		selectedSessionKey,
	]);

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
						preferredSessionKey={preferredSessionKey}
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
							preferredSessionKey={preferredSessionKey}
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
