import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { listInstances } from "../api/instanceClient";
import type { InstanceItem } from "../api/types";
import { useCurrentInstanceId } from "../hooks/useCurrentInstance";
import { useIsMobile } from "../hooks/useIsMobile";
import { InstanceFormModal } from "./InstanceFormModal";

const MAX_INSTANCES = 3;

function formatLastCheck(isoString: string | null): string {
	if (!isoString) return "从未";
	try {
		const date = new Date(isoString);
		return date.toLocaleString("zh-CN", {
			month: "numeric",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
	} catch {
		return "未知";
	}
}

export function InstanceTopology(): JSX.Element {
	const isMobile = useIsMobile();
	const [, setCurrentInstanceId] = useCurrentInstanceId();
	const [instances, setInstances] = useState<InstanceItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [selectedInstance, setSelectedInstance] = useState<InstanceItem | null>(
		null,
	);
	const [isFormModalOpen, setIsFormModalOpen] = useState(false);
	const [editingInstance, setEditingInstance] = useState<InstanceItem | null>(
		null,
	);

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

	const handleInstanceClick = useCallback(
		(instance: InstanceItem): void => {
			setCurrentInstanceId(instance.id);
			setSelectedInstance(instance);
		},
		[setCurrentInstanceId],
	);

	const handleCloseDetailModal = useCallback((): void => {
		setSelectedInstance(null);
	}, []);

	const handleOpenCreateModal = useCallback((): void => {
		setEditingInstance(null);
		setIsFormModalOpen(true);
	}, []);

	const handleOpenEditModal = useCallback((): void => {
		if (selectedInstance) {
			setEditingInstance(selectedInstance);
			setSelectedInstance(null);
			setIsFormModalOpen(true);
		}
	}, [selectedInstance]);

	const handleCloseFormModal = useCallback((): void => {
		setIsFormModalOpen(false);
		setEditingInstance(null);
	}, []);

	const handleFormSuccess = useCallback((): void => {
		setIsFormModalOpen(false);
		setEditingInstance(null);
		void loadInstances();
	}, [loadInstances]);

	const canAddMore = instances.length < MAX_INSTANCES;

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
			<div style={getCanvasStyle(isMobile)}>
				{instances.length === 0 ? (
					<div style={emptyStateStyle}>
						<div style={emptyIconStyle}>
							<svg
								width="48"
								height="48"
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
						<p style={emptyHintStyle}>点击右下角按钮添加第一个实例</p>
					</div>
				) : (
					<div style={topologyContainerStyle}>
						{instances.map((instance) => (
							<button
								key={instance.id}
								type="button"
								style={getInstanceNodeStyle(instance.status, isMobile)}
								onClick={() => handleInstanceClick(instance)}
								aria-label={`实例 ${instance.name}`}
							>
								<div style={nodeIconStyle}>
									<InstanceIcon
										status={instance.status}
										size={isMobile ? 32 : 40}
									/>
									{instance.status === "active" && (
										<div style={healthPulseStyle} />
									)}
								</div>
								<div style={nodeInfoStyle}>
									<span style={getNodeNameStyle(isMobile)}>
										{instance.name}
									</span>
									<div style={nodeBadgesStyle}>
										<span style={getStatusBadgeStyle(instance.status)}>
											{instance.status === "active" ? "活跃" : "未活跃"}
										</span>
									</div>
									<span style={nodeEndpointStyle}>{instance.endpoint}</span>
								</div>
							</button>
						))}
					</div>
				)}
			</div>

			{/* Instance Detail Modal */}
			{selectedInstance && (
				<div style={modalOverlayStyle}>
					<button
						type="button"
						style={modalBackdropButtonStyle}
						onClick={handleCloseDetailModal}
						aria-label="关闭详情弹窗遮罩"
						data-testid="detail-modal-overlay"
					/>
					<div
						style={getModalStyle(isMobile)}
						role="dialog"
						aria-modal="true"
						aria-labelledby="detail-modal-title"
					>
						<div style={modalHeaderStyle}>
							<h2 id="detail-modal-title" style={modalTitleStyle}>
								实例详情
							</h2>
							<button
								type="button"
								style={closeButtonStyle}
								onClick={handleCloseDetailModal}
								aria-label="关闭详情弹窗"
							>
								×
							</button>
						</div>
						<div style={modalBodyStyle}>
							<div style={infoRowStyle}>
								<span style={infoLabelStyle}>实例名称</span>
								<span style={infoValueStyle}>{selectedInstance.name}</span>
							</div>
							<div style={infoRowStyle}>
								<span style={infoLabelStyle}>类型</span>
								<span style={infoValueStyle}>{selectedInstance.type}</span>
							</div>
							<div style={infoRowStyle}>
								<span style={infoLabelStyle}>端点地址</span>
								<span style={infoValueStyle}>{selectedInstance.endpoint}</span>
							</div>
							<div style={infoRowStyle}>
								<span style={infoLabelStyle}>状态</span>
								<span style={getStatusBadgeStyle(selectedInstance.status)}>
									{selectedInstance.status === "active" ? "活跃" : "未活跃"}
								</span>
							</div>
							<div style={infoRowStyle}>
								<span style={infoLabelStyle}>最后检查</span>
								<span style={infoValueStyle}>
									{formatLastCheck(selectedInstance.last_check_at)}
								</span>
							</div>
							<div style={infoRowStyle}>
								<span style={infoLabelStyle}>创建时间</span>
								<span style={infoValueStyle}>
									{formatLastCheck(selectedInstance.created_at)}
								</span>
							</div>
							<div style={readonlyHintRowStyle}>
								<span style={readonlyHintTextStyle}>
									当前阶段仅保留观察与进入能力
								</span>
							</div>
						</div>
						<div style={modalFooterStyle}>
							<button
								type="button"
								style={editButtonStyle}
								onClick={handleOpenEditModal}
							>
								配置
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Instance Form Modal */}
			{isFormModalOpen && (
				<InstanceFormModal
					instance={editingInstance}
					onClose={handleCloseFormModal}
					onSuccess={handleFormSuccess}
				/>
			)}

			{/* FAB - Add Instance */}
			<button
				type="button"
				style={getFabStyle(isMobile, canAddMore)}
				onClick={canAddMore ? handleOpenCreateModal : undefined}
				disabled={!canAddMore}
				title={canAddMore ? "添加实例" : "最多可添加3个实例"}
				aria-label={canAddMore ? "添加实例" : "已达到实例数量上限"}
			>
				+
			</button>
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

function getCanvasStyle(isMobile: boolean): React.CSSProperties {
	return {
		display: "flex",
		justifyContent: "center",
		alignItems: isMobile ? "stretch" : "flex-start",
		minHeight: isMobile ? "40vh" : "60vh",
		padding: isMobile ? "0.5rem" : "2rem",
	};
}

const topologyContainerStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	gap: "1rem",
	width: "100%",
	maxWidth: "400px",
};

function getInstanceNodeStyle(
	status: string,
	isMobile: boolean,
): React.CSSProperties {
	const borderColor = status === "active" ? "#10b981" : "#d1d5db";
	const shadow =
		status === "active" ? "0 0 0 3px rgba(16, 185, 129, 0.1)" : "none";

	return {
		display: "flex",
		alignItems: "center",
		gap: "1rem",
		padding: isMobile ? "1rem" : "1.25rem",
		background: "#fff",
		border: `2px solid ${borderColor}`,
		borderRadius: isMobile ? "0.75rem" : "1rem",
		cursor: "pointer",
		transition: "all 0.2s",
		boxShadow: shadow,
		width: "100%",
		textAlign: "left",
		fontFamily: "inherit",
		fontSize: "inherit",
		color: "inherit",
	};
}

const nodeIconStyle: React.CSSProperties = {
	position: "relative",
	flexShrink: 0,
};

const nodeInfoStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "0.25rem",
	flex: 1,
	minWidth: 0,
};

function getNodeNameStyle(isMobile: boolean): React.CSSProperties {
	return {
		fontSize: isMobile ? "1rem" : "1.125rem",
		fontWeight: 600,
		color: "#1f2933",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	};
}

const nodeBadgesStyle: React.CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: "0.5rem",
};

function getStatusBadgeStyle(status: string): React.CSSProperties {
	const isActive = status === "active";
	return {
		fontSize: "0.75rem",
		padding: "0.125rem 0.5rem",
		borderRadius: "0.25rem",
		background: isActive ? "#dcfce7" : "#f3f4f6",
		color: isActive ? "#166534" : "#6b7280",
		fontWeight: 500,
	};
}

const nodeEndpointStyle: React.CSSProperties = {
	fontSize: "0.75rem",
	color: "#6b7280",
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
};

const healthPulseStyle: React.CSSProperties = {
	position: "absolute",
	top: "50%",
	left: "50%",
	transform: "translate(-50%, -50%)",
	width: "50px",
	height: "50px",
	borderRadius: "50%",
	background: "rgba(16, 185, 129, 0.2)",
	animation: "pulse 2s ease-in-out infinite",
};

const emptyStateStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "center",
	padding: "2rem",
	textAlign: "center",
};

const emptyIconStyle: React.CSSProperties = {
	marginBottom: "1rem",
	opacity: 0.5,
};

const emptyTitleStyle: React.CSSProperties = {
	fontSize: "1rem",
	color: "#6b7280",
	margin: "0 0 0.5rem 0",
	fontWeight: 500,
};

const emptyHintStyle: React.CSSProperties = {
	fontSize: "0.875rem",
	color: "#9ca3af",
	margin: 0,
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

const modalOverlayStyle: React.CSSProperties = {
	position: "fixed",
	top: 0,
	left: 0,
	right: 0,
	bottom: 0,
	background: "rgba(0, 0, 0, 0.5)",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	zIndex: 200,
};

const modalBackdropButtonStyle: React.CSSProperties = {
	position: "absolute",
	inset: 0,
	border: "none",
	background: "transparent",
	padding: 0,
	margin: 0,
	cursor: "pointer",
};

function getModalStyle(isMobile: boolean): React.CSSProperties {
	return {
		position: "relative",
		zIndex: 1,
		background: "#fff",
		borderRadius: "0.75rem",
		width: isMobile ? "calc(100% - 2rem)" : "400px",
		maxWidth: "90%",
		boxShadow:
			"0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
		overflow: "hidden",
	};
}

const modalHeaderStyle: React.CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	padding: "1rem 1.25rem",
	borderBottom: "1px solid #e5e7eb",
};

const modalTitleStyle: React.CSSProperties = {
	fontSize: "1.125rem",
	fontWeight: 600,
	color: "#1f2933",
	margin: 0,
};

const closeButtonStyle: React.CSSProperties = {
	width: "32px",
	height: "32px",
	borderRadius: "0.375rem",
	border: "none",
	background: "transparent",
	color: "#6b7280",
	fontSize: "1.5rem",
	cursor: "pointer",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	lineHeight: 1,
};

const modalBodyStyle: React.CSSProperties = {
	padding: "1.25rem",
};

const infoRowStyle: React.CSSProperties = {
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	padding: "0.75rem 0",
	borderBottom: "1px solid #f3f4f6",
};

const infoLabelStyle: React.CSSProperties = {
	fontSize: "0.875rem",
	color: "#6b7280",
};

const infoValueStyle: React.CSSProperties = {
	fontSize: "0.875rem",
	color: "#1f2933",
	fontWeight: 500,
};

const modalFooterStyle: React.CSSProperties = {
	padding: "1rem 1.25rem",
	borderTop: "1px solid #e5e7eb",
	display: "flex",
	justifyContent: "flex-end",
	gap: "0.75rem",
};

const editButtonStyle: React.CSSProperties = {
	padding: "0.625rem 1.25rem",
	background: "#3b82f6",
	color: "#fff",
	border: "none",
	borderRadius: "0.5rem",
	fontSize: "0.875rem",
	fontWeight: 500,
	cursor: "pointer",
};

const readonlyHintRowStyle: React.CSSProperties = {
	padding: "0.75rem",
	background: "#f3f4f6",
	borderRadius: "0.5rem",
	marginTop: "1rem",
	textAlign: "center",
};

const readonlyHintTextStyle: React.CSSProperties = {
	fontSize: "0.75rem",
	color: "#6b7280",
};

function getFabStyle(isMobile: boolean, canAdd: boolean): React.CSSProperties {
	return {
		position: "fixed",
		bottom: isMobile ? "calc(56px + 1rem)" : "2rem",
		right: "1rem",
		width: "48px",
		height: "48px",
		borderRadius: "50%",
		border: "none",
		background: canAdd ? "#3b82f6" : "#6b7280",
		color: "#fff",
		fontSize: "1.5rem",
		cursor: canAdd ? "pointer" : "not-allowed",
		opacity: canAdd ? 1 : 0.5,
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
		zIndex: 90,
		transition: "all 0.2s",
	};
}
