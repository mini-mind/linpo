import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as instanceClient from "../api/instanceClient";
import type { InstanceItem } from "../api/types";

import { InstanceTopology } from "./InstanceTopology";

vi.mock("react-router-dom", () => ({
	useNavigate: () => vi.fn(),
}));

vi.mock("../hooks/useIsMobile", () => ({
	useIsMobile: () => false,
}));

vi.mock("../hooks/useCurrentInstance", () => ({
	useCurrentInstanceId: () => ["instance-1", vi.fn(), vi.fn()],
}));

const mockInstances: InstanceItem[] = [
	{
		id: "instance-1",
		name: "测试实例1",
		type: "openclaw",
		endpoint: "http://127.0.0.1:28789",
		status: "active",
		last_check_at: "2025-03-18T10:00:00Z",
		created_at: "2025-03-18T08:00:00Z",
	},
];

describe("InstanceTopology readonly mode", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(instanceClient, "listInstances").mockResolvedValue(mockInstances);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("keeps the detail modal readonly on the real path", async () => {
		render(<InstanceTopology />);

		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: "实例 测试实例1" }),
			).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole("button", { name: "实例 测试实例1" }));

		await waitFor(() => {
			expect(screen.getByRole("dialog")).toBeInTheDocument();
		});

		expect(
			screen.getByText(/当前阶段仅保留观察与进入能力/i),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /^删除$/i }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /进入会话页/i }),
		).not.toBeInTheDocument();
	});
});
