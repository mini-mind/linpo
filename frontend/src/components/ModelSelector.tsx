import type { ModelItem } from "../api/types";

interface ModelSelectorProps {
	models: ModelItem[];
	selectedId: string | null;
	onChange: (modelId: string) => Promise<void>;
	loading?: boolean;
	disabled?: boolean;
	updateStatus?: "updating" | "success" | "failed" | null;
}

export function ModelSelector({
	models,
	selectedId,
	onChange,
	loading = false,
	disabled = false,
	updateStatus = null,
}: ModelSelectorProps) {
	const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
		const value = e.target.value;
		if (value) {
			await onChange(value);
		}
	};

	return (
		<div style={containerStyle}>
			<div style={rowStyle}>
				<span style={labelStyle}>模型:</span>
				<select
					value={selectedId ?? ""}
					onChange={handleChange}
					disabled={disabled || updateStatus === "updating"}
					style={selectStyle}
				>
					{loading ? (
						<option value="">加载中...</option>
					) : models.length === 0 ? (
						<option value="">暂无可用模型</option>
					) : (
						<>
							<option value="">请选择模型</option>
							{models.map((model, index) => (
								<option
									key={`${model.id}-${model.provider}-${index}`}
									value={model.id}
								>
									{model.name}
								</option>
							))}
						</>
					)}
				</select>
				{updateStatus === "updating" && (
					<span style={updatingBadgeStyle}>更新中...</span>
				)}
				{updateStatus === "success" && (
					<span style={successBadgeStyle}>✓ 已切换</span>
				)}
				{updateStatus === "failed" && (
					<span style={failedBadgeStyle}>✗ 失败</span>
				)}
			</div>
		</div>
	);
}

const containerStyle: React.CSSProperties = {
	width: "100%",
};

const rowStyle: React.CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: "0.5rem",
	flexWrap: "wrap",
};

const labelStyle: React.CSSProperties = {
	fontSize: "0.75rem",
	color: "#6b7280",
	fontWeight: 500,
	whiteSpace: "nowrap",
};

const selectStyle: React.CSSProperties = {
	padding: "0.25rem 0.5rem",
	fontSize: "0.75rem",
	borderRadius: "0.25rem",
	border: "1px solid #d1d5db",
	background: "#fff",
	color: "#1f2933",
	cursor: "pointer",
	minWidth: "120px",
	maxWidth: "200px",
	flex: "1 1 auto",
};

const updatingBadgeStyle: React.CSSProperties = {
	fontSize: "0.75rem",
	padding: "0.25rem 0.5rem",
	borderRadius: "0.25rem",
	background: "#dbeafe",
	color: "#1e40af",
	fontWeight: 500,
	whiteSpace: "nowrap",
};

const successBadgeStyle: React.CSSProperties = {
	fontSize: "0.75rem",
	padding: "0.25rem 0.5rem",
	borderRadius: "0.25rem",
	background: "#dcfce7",
	color: "#166534",
	fontWeight: 500,
	whiteSpace: "nowrap",
};

const failedBadgeStyle: React.CSSProperties = {
	fontSize: "0.75rem",
	padding: "0.25rem 0.5rem",
	borderRadius: "0.25rem",
	background: "#fee2e2",
	color: "#991b1b",
	fontWeight: 500,
	whiteSpace: "nowrap",
};
