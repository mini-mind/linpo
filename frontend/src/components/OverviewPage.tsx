import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listInstances } from "../api/instanceClient";
import type { InstanceItem } from "../api/types";
import { useIsMobile } from "../hooks/useIsMobile";

export function OverviewPage(): JSX.Element {
	const isMobile = useIsMobile();
	const [instances, setInstances] = useState<InstanceItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const loadInstances = useCallback(async () => {
		try {
			setLoading(true);
			setError(null);
			const data = await listInstances();
			setInstances(data);
		} catch (err) {
			const message = err instanceof Error ? err.message : "获取实例列表失败";
			setError(message);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadInstances();
	}, [loadInstances]);

	const activeInstances = instances.filter((i) => i.status === "active");
	const inactiveInstances = instances.filter((i) => i.status !== "active");

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

	return (
		<div style={getContainerStyle(isMobile)}>
			{/* Page Header */}
			<div style={headerStyle}>
				<h1 style={titleStyle}>总览</h1>
				<p style={subtitleStyle}>实例状态一览</p>
			</div>

			{/* Statistics Cards */}
			<div style={getStatsGridStyle(isMobile)}>
				<div style={getStatCardStyle(isMobile)}>
					<span style={statLabelStyle}>实例总数</span>
					<span style={statValueStyle}>{instances.length}</span>
				</div>
				<div style={getStatCardStyle(isMobile, "success")}>
					<span style={statLabelStyle}>活跃实例</span>
					<span style={getStatValueColorStyle("success")}>
						{activeInstances.length}
					</span>
				</div>
				<div style={getStatCardStyle(isMobile, "warning")}>
					<span style={statLabelStyle}>需要关注</span>
					<span style={getStatValueColorStyle("warning")}>
						{inactiveInstances.length}
					</span>
				</div>
			</div>

			{/* Instance List or Empty State */}
			{instances.length === 0 ? (
				<div style={emptyStateStyle}>
					<div style={emptyIconStyle}>
						<svg
							width="64"
							height="64"
							viewBox="0 0 24 24"
							fill="none"
							stroke="#9ca3af"
							strokeWidth="1.5"
						>
							<title>Empty State Icon</title>
							<rect x="2" y="3" width="20" height="14" rx="2" />
							<line x1="8" y1="21" x2="16" y2="21" />
							<line x1="12" y1="17" x2="12" y2="21" />
						</svg>
					</div>
					<p style={emptyTitleStyle}>暂无实例</p>
					<p style={emptyHintStyle}>
						前往拓扑页面添加你的第一个实例
					</p>
					<Link to="/topology" style={emptyLinkStyle}>
						前往拓扑
					</Link>
				</div>
			) : (
				<>
					{/* Instance Cards */}
					<div style={getInstanceGridStyle(isMobile)}>
						{instances.map((instance) => (
							<div
								key={instance.id}
								style={getInstanceCardStyle(instance.status, isMobile)}
							>
								<div style={instanceHeaderStyle}>
									<div style={instanceIconStyle}>
										<InstanceIcon
											status={instance.status}
											size={24}
										/>
										{instance.status !== "active" && (
											<img
												src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23f59e0b'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cpath fill='%23fff' d='M12 6v6l4 2'/%3E%3C/svg%3E"
												alt="需要关注"
												style={attentionIconStyle}
											/>
										)}
									</div>
									<div style={instanceInfoStyle}>
										<span style={instanceNameStyle}>
											{instance.name}
										</span>
										<span
											style={getStatusBadgeStyle(instance.status)}
										>
											{instance.status === "active"
												? "活跃"
												: "未活跃"}
										</span>
									</div>
								</div>
								<div style={instanceMetaStyle}>
									<span style={instanceEndpointStyle}>
										{instance.endpoint}
									</span>
								</div>
								<div style={instanceActionsStyle}>
									{instance.status === "active" ? (
										<Link
											to={`/session/${instance.id}/main`}
											style={primaryButtonStyle}
											aria-label={`进入会话 - ${instance.name}`}
										>
											进入会话
										</Link>
									) : (
										<span style={disabledButtonStyle}>
											实例未激活
										</span>
									)}
								</div>
							</div>
						))}
					</div>

					{/* Navigation Links */}
					<div style={getNavigationStyle(isMobile)}>
						<Link to="/topology" style={navLinkStyle}>
							<span style={navIconStyle}>◇</span>
							查看拓扑
						</Link>
						<Link to="/session" style={navLinkStyle}>
							<span style={navIconStyle}>◉</span>
							进入会话
						</Link>
					</div>
				</>
			)}
		</div>
	);
}

function InstanceIcon({
	status,
	size,
}: {
	status: string;
	size: number;
}): JSX.Element {
	const color = status === "active" ? "#10b981" : "#9ca3af";
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke={color}
			strokeWidth="2"
			aria-hidden="true"
		>
			<rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
			<line x1="8" y1="21" x2="16" y2="21" />
			<line x1="12" y1="17" x2="12" y2="21" />
		</svg>
	);
}

// Container Styles
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

// Statistics Grid
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

// Instance Grid
function getInstanceGridStyle(isMobile: boolean): React.CSSProperties {
	return {
		display: "grid",
		gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(280px, 1fr))",
		gap: "1rem",
		marginBottom: "1.5rem",
	};
}

function getInstanceCardStyle(
	status: string,
	isMobile: boolean,
): React.CSSProperties {
	const borderColor = status === "active" ? "#10b981" : "#f59e0b";

	return {
		background: "#fff",
		border: `2px solid ${borderColor}`,
		borderRadius: "0.75rem",
		padding: isMobile ? "1rem" : "1.25rem",
		display: "flex",
		flexDirection: "column",
		gap: "0.75rem",
	};
}

const instanceHeaderStyle: React.CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: "0.75rem",
};

const instanceIconStyle: React.CSSProperties = {
	position: "relative",
	flexShrink: 0,
};

const attentionIconStyle: React.CSSProperties = {
	position: "absolute",
	bottom: "-4px",
	right: "-4px",
	width: "14px",
	height: "14px",
};

const instanceInfoStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "0.25rem",
	flex: 1,
	minWidth: 0,
};

const instanceNameStyle: React.CSSProperties = {
	fontSize: "1rem",
	fontWeight: 600,
	color: "#1f2933",
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
};

function getStatusBadgeStyle(status: string): React.CSSProperties {
	const isActive = status === "active";
	return {
		fontSize: "0.75rem",
		padding: "0.125rem 0.5rem",
		borderRadius: "0.25rem",
		background: isActive ? "#dcfce7" : "#fef3c7",
		color: isActive ? "#166534" : "#92400e",
		fontWeight: 500,
		alignSelf: "flex-start",
	};
}

const instanceMetaStyle: React.CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: "0.5rem",
};

const instanceEndpointStyle: React.CSSProperties = {
	fontSize: "0.75rem",
	color: "#6b7280",
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
};

const instanceActionsStyle: React.CSSProperties = {
	display: "flex",
	gap: "0.5rem",
	marginTop: "0.25rem",
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
	cursor: "pointer",
	transition: "background 0.2s",
};

const disabledButtonStyle: React.CSSProperties = {
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	padding: "0.5rem 1rem",
	background: "#e5e7eb",
	color: "#6b7280",
	borderRadius: "0.5rem",
	fontSize: "0.875rem",
	fontWeight: 500,
};

// Empty State
const emptyStateStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "center",
	padding: "3rem 2rem",
	textAlign: "center",
};

const emptyIconStyle: React.CSSProperties = {
	marginBottom: "1rem",
	opacity: 0.5,
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

// Navigation
function getNavigationStyle(isMobile: boolean): React.CSSProperties {
	return {
		display: "flex",
		gap: "1rem",
		flexWrap: "wrap",
		justifyContent: isMobile ? "center" : "flex-start",
	};
}

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
	transition: "all 0.2s",
};

const navIconStyle: React.CSSProperties = {
	fontSize: "1rem",
};

// Utility Styles
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