import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InstanceTopology } from './InstanceTopology';
import * as instanceClient from '../api/instanceClient';
import type { InstanceItem } from '../api/types';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('../hooks/useIsMobile', () => ({
  useIsMobile: () => false,
}));

const mockInstances: InstanceItem[] = [
  {
    id: 'instance-1',
    name: '测试实例1',
    type: 'openclaw',
    endpoint: 'http://127.0.0.1:28789',
    status: 'active',
    last_check_at: '2025-03-18T10:00:00Z',
    created_at: '2025-03-18T08:00:00Z',
  },
  {
    id: 'instance-2',
    name: '测试实例2',
    type: 'openclaw',
    endpoint: 'http://127.0.0.1:38789',
    status: 'inactive',
    last_check_at: null,
    created_at: '2025-03-18T09:00:00Z',
  },
];

describe('InstanceTopology', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Empty State', () => {
    it('renders empty state when no instances exist', async () => {
      vi.spyOn(instanceClient, 'listInstances').mockResolvedValue([]);

      render(<InstanceTopology />);

      await waitFor(() => {
        expect(screen.getByText('暂无实例')).toBeInTheDocument();
      });

      expect(screen.getByText('点击右下角按钮添加第一个实例')).toBeInTheDocument();
    });

    it('shows add button in empty state', async () => {
      vi.spyOn(instanceClient, 'listInstances').mockResolvedValue([]);

      render(<InstanceTopology />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /添加实例/i })).toBeInTheDocument();
      });
    });
  });

  describe('Instance Node Rendering', () => {
    it('renders instance nodes when instances exist', async () => {
      vi.spyOn(instanceClient, 'listInstances').mockResolvedValue(mockInstances);

      render(<InstanceTopology />);

      await waitFor(() => {
        expect(screen.getByText('测试实例1')).toBeInTheDocument();
      });

      expect(screen.getByText('测试实例2')).toBeInTheDocument();
    });

    it('displays instance status for each node', async () => {
      vi.spyOn(instanceClient, 'listInstances').mockResolvedValue(mockInstances);

      render(<InstanceTopology />);

      await waitFor(() => {
        expect(screen.getByText('活跃')).toBeInTheDocument();
      });

      expect(screen.getByText('未活跃')).toBeInTheDocument();
    });

    it('displays instance endpoint', async () => {
      vi.spyOn(instanceClient, 'listInstances').mockResolvedValue(mockInstances);

      render(<InstanceTopology />);

      await waitFor(() => {
        expect(screen.getByText('http://127.0.0.1:28789')).toBeInTheDocument();
      });
    });
  });

  describe('Modal Open/Close', () => {
    it('opens instance details modal when clicking a node', async () => {
      vi.spyOn(instanceClient, 'listInstances').mockResolvedValue(mockInstances);

      render(<InstanceTopology />);

      await waitFor(() => {
        expect(screen.getByText('测试实例1')).toBeInTheDocument();
      });

      const node = screen.getByRole('button', { name: '实例 测试实例1' });
      fireEvent.click(node);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      expect(screen.getByText('实例详情')).toBeInTheDocument();
    });

    it('closes modal when clicking close button', async () => {
      vi.spyOn(instanceClient, 'listInstances').mockResolvedValue(mockInstances);

      render(<InstanceTopology />);

      await waitFor(() => {
        expect(screen.getByText('测试实例1')).toBeInTheDocument();
      });

      const node = screen.getByRole('button', { name: '实例 测试实例1' });
      fireEvent.click(node);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      const closeButton = screen.getByRole('button', { name: '关闭详情弹窗' });
      fireEvent.click(closeButton);

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    it('closes modal when clicking overlay', async () => {
      vi.spyOn(instanceClient, 'listInstances').mockResolvedValue(mockInstances);

      render(<InstanceTopology />);

      await waitFor(() => {
        expect(screen.getByText('测试实例1')).toBeInTheDocument();
      });

      const node = screen.getByRole('button', { name: '实例 测试实例1' });
      fireEvent.click(node);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      const overlay = screen.getByTestId('detail-modal-overlay');
      fireEvent.click(overlay);

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    it('stores current instance context before entering session page', async () => {
      window.localStorage.removeItem('linpo.currentInstanceId');
      vi.spyOn(instanceClient, 'listInstances').mockResolvedValue(mockInstances);

      render(<InstanceTopology />);

      await waitFor(() => {
        expect(screen.getByText('测试实例1')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: '实例 测试实例1' }));

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: '进入会话页' }));

      expect(window.localStorage.getItem('linpo.currentInstanceId')).toBe('instance-1');
      expect(mockNavigate).toHaveBeenCalledWith('/session');
    });
  });

  describe('Instance Form Modal', () => {
    it('opens create instance form when clicking add button', async () => {
      vi.spyOn(instanceClient, 'listInstances').mockResolvedValue([]);

      render(<InstanceTopology />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /添加实例/i })).toBeInTheDocument();
      });

      const addButton = screen.getByRole('button', { name: /添加实例/i });
      fireEvent.click(addButton);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      expect(screen.getByText('添加实例')).toBeInTheDocument();
    });

    it('validates form fields before submit', async () => {
      vi.spyOn(instanceClient, 'listInstances').mockResolvedValue([]);

      render(<InstanceTopology />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /添加实例/i })).toBeInTheDocument();
      });

      const addButton = screen.getByRole('button', { name: /添加实例/i });
      fireEvent.click(addButton);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      const nameInput = screen.getByLabelText('实例名称');
      const endpointInput = screen.getByLabelText('端点地址');

      fireEvent.change(nameInput, { target: { value: '' } });
      fireEvent.change(endpointInput, { target: { value: '' } });

      const saveButton = screen.getByRole('button', { name: /保存/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(screen.getByText('实例名称不能为空')).toBeInTheDocument();
      });
    });

    it('calls validate endpoint when testing connection', async () => {
      const validateMock = vi.spyOn(instanceClient, 'validateInstance').mockResolvedValue({
        ok: true,
        status: 'active',
        message: '验证成功',
      });

      vi.spyOn(instanceClient, 'listInstances').mockResolvedValue([]);

      render(<InstanceTopology />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /添加实例/i })).toBeInTheDocument();
      });

      const addButton = screen.getByRole('button', { name: /添加实例/i });
      fireEvent.click(addButton);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      fireEvent.change(screen.getByLabelText('实例名称'), { target: { value: '新实例' } });
      fireEvent.change(screen.getByLabelText('端点地址'), { target: { value: 'http://127.0.0.1:48789' } });
      fireEvent.change(screen.getByLabelText('Gateway Token'), { target: { value: 'test-token' } });

      const testButton = screen.getByRole('button', { name: /测试连接/i });
      fireEvent.click(testButton);

      await waitFor(() => {
        expect(validateMock).toHaveBeenCalledWith({
          name: '新实例',
          type: 'openclaw',
          endpoint: 'http://127.0.0.1:48789',
          gatewayToken: 'test-token',
        });
      });
    });

    it('shows validation error when test connection fails', async () => {
      vi.spyOn(instanceClient, 'validateInstance').mockResolvedValue({
        ok: false,
        status: 'failed',
        message: 'gateway token 校验失败',
        code: 'auth_failed',
      });

      vi.spyOn(instanceClient, 'listInstances').mockResolvedValue([]);

      render(<InstanceTopology />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /添加实例/i })).toBeInTheDocument();
      });

      const addButton = screen.getByRole('button', { name: /添加实例/i });
      fireEvent.click(addButton);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      fireEvent.change(screen.getByLabelText('实例名称'), { target: { value: '新实例' } });
      fireEvent.change(screen.getByLabelText('端点地址'), { target: { value: 'http://127.0.0.1:48789' } });
      fireEvent.change(screen.getByLabelText('Gateway Token'), { target: { value: 'bad-token' } });

      const testButton = screen.getByRole('button', { name: /测试连接/i });
      fireEvent.click(testButton);

      await waitFor(() => {
        expect(screen.getByText('gateway token 校验失败')).toBeInTheDocument();
      });
    });

    it('shows success message when test connection succeeds', async () => {
      vi.spyOn(instanceClient, 'validateInstance').mockResolvedValue({
        ok: true,
        status: 'active',
        message: '连接成功',
      });

      vi.spyOn(instanceClient, 'listInstances').mockResolvedValue([]);

      render(<InstanceTopology />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /添加实例/i })).toBeInTheDocument();
      });

      const addButton = screen.getByRole('button', { name: /添加实例/i });
      fireEvent.click(addButton);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      fireEvent.change(screen.getByLabelText('实例名称'), { target: { value: '新实例' } });
      fireEvent.change(screen.getByLabelText('端点地址'), { target: { value: 'http://127.0.0.1:48789' } });
      fireEvent.change(screen.getByLabelText('Gateway Token'), { target: { value: 'valid-token' } });

      const testButton = screen.getByRole('button', { name: /测试连接/i });
      fireEvent.click(testButton);

      await waitFor(() => {
        expect(screen.getByText('连接成功')).toBeInTheDocument();
      });
    });
  });

  describe('Max-3 UX Enforcement', () => {
    it('disables add button when user has 3 instances', async () => {
      const threeInstances = [
        ...mockInstances,
        {
          id: 'instance-3',
          name: '测试实例3',
          type: 'openclaw',
          endpoint: 'http://127.0.0.1:58789',
          status: 'active',
          last_check_at: '2025-03-18T10:00:00Z',
          created_at: '2025-03-18T08:00:00Z',
        },
      ];

      vi.spyOn(instanceClient, 'listInstances').mockResolvedValue(threeInstances);

      render(<InstanceTopology />);

      await waitFor(() => {
        expect(screen.getByText('测试实例3')).toBeInTheDocument();
      });

      const addButton = screen.getByRole('button', { name: /已达到实例数量上限/i });
      expect(addButton).toBeDisabled();
    });

    it('shows tooltip or hint when add button is disabled', async () => {
      const threeInstances = [
        ...mockInstances,
        {
          id: 'instance-3',
          name: '测试实例3',
          type: 'openclaw',
          endpoint: 'http://127.0.0.1:58789',
          status: 'active',
          last_check_at: '2025-03-18T10:00:00Z',
          created_at: '2025-03-18T08:00:00Z',
        },
      ];

      vi.spyOn(instanceClient, 'listInstances').mockResolvedValue(threeInstances);

      render(<InstanceTopology />);

      await waitFor(() => {
        expect(screen.getByText('测试实例3')).toBeInTheDocument();
      });

      const addButton = screen.getByRole('button', { name: /已达到实例数量上限/i });
      expect(addButton).toHaveAttribute('title', '最多可添加3个实例');
    });
  });

  describe('Edit Instance', () => {
    it('opens edit form when clicking edit in details modal', async () => {
      vi.spyOn(instanceClient, 'listInstances').mockResolvedValue(mockInstances);

      render(<InstanceTopology />);

      await waitFor(() => {
        expect(screen.getByText('测试实例1')).toBeInTheDocument();
      });

      const node = screen.getByRole('button', { name: '实例 测试实例1' });
      fireEvent.click(node);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      const editButton = screen.getByRole('button', { name: /编辑/i });
      fireEvent.click(editButton);

      await waitFor(() => {
        expect(screen.getByText('编辑实例')).toBeInTheDocument();
      });

      const nameInput = screen.getByLabelText('实例名称') as HTMLInputElement;
      expect(nameInput.value).toBe('测试实例1');
    });
  });

  describe('Go to Session Page', () => {
    it('navigates to session page when clicking 进入会话页 button', async () => {
      vi.spyOn(instanceClient, 'listInstances').mockResolvedValue(mockInstances);

      render(<InstanceTopology />);

      await waitFor(() => {
        expect(screen.getByText('测试实例1')).toBeInTheDocument();
      });

      const node = screen.getByRole('button', { name: '实例 测试实例1' });
      fireEvent.click(node);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      const sessionButton = screen.getByRole('button', { name: /进入会话页/i });
      fireEvent.click(sessionButton);

      expect(mockNavigate).toHaveBeenCalledWith('/session');
    });
  });

  describe('Delete Instance', () => {
    it('shows local error when delete fails', async () => {
      vi.spyOn(instanceClient, 'listInstances').mockResolvedValue(mockInstances);
      vi.spyOn(instanceClient, 'deleteInstance').mockRejectedValue(new Error('删除失败'));

      render(<InstanceTopology />);

      await waitFor(() => {
        expect(screen.getByText('测试实例1')).toBeInTheDocument();
      });

      const node = screen.getByRole('button', { name: '实例 测试实例1' });
      fireEvent.click(node);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      const deleteButton = screen.getByRole('button', { name: /删除/i });
      fireEvent.click(deleteButton);

      await waitFor(() => {
        expect(screen.getByText('删除失败')).toBeInTheDocument();
      });

      // Modal should still be open
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  describe('Loading and Error States', () => {
    it('shows loading state while fetching instances', () => {
      vi.spyOn(instanceClient, 'listInstances').mockImplementation(
        () => new Promise(() => {})
      );

      render(<InstanceTopology />);

      expect(screen.getByText('加载中...')).toBeInTheDocument();
    });

    it('shows error state when fetch fails', async () => {
      vi.spyOn(instanceClient, 'listInstances').mockRejectedValue(new Error('网络错误'));

      render(<InstanceTopology />);

      await waitFor(() => {
        expect(screen.getByText(/错误/i)).toBeInTheDocument();
      });
    });
  });
});
