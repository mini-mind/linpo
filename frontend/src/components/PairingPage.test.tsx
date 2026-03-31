import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { InstanceItem } from '../api/types';
import { ToastProvider } from '../hooks/useToast';
import { PairingPage } from './PairingPage';

const {
  mockListInstances,
  mockValidateInstance,
  mockCreateInstance,
  mockValidateInstanceByPairCode,
  mockCreateInstanceByPairCode,
  mockDeleteInstance,
} = vi.hoisted(() => ({
  mockListInstances: vi.fn(),
  mockValidateInstance: vi.fn(),
  mockCreateInstance: vi.fn(),
  mockValidateInstanceByPairCode: vi.fn(),
  mockCreateInstanceByPairCode: vi.fn(),
  mockDeleteInstance: vi.fn(),
}));

vi.mock('../api/instanceClient', async () => {
  const actual = await vi.importActual<typeof import('../api/instanceClient')>('../api/instanceClient');
  return {
    ...actual,
    listInstances: mockListInstances,
    validateInstance: mockValidateInstance,
    createInstance: mockCreateInstance,
    validateInstanceByPairCode: mockValidateInstanceByPairCode,
    createInstanceByPairCode: mockCreateInstanceByPairCode,
    deleteInstance: mockDeleteInstance,
  };
});

function buildInstance(overrides: Partial<InstanceItem> = {}): InstanceItem {
  return {
    id: 'inst-1',
    name: 'claw2',
    type: 'openclaw',
    endpoint: 'http://127.0.0.1:28789',
    status: 'online',
    last_check_at: '2026-03-30T08:00:00Z',
    created_at: '2026-03-30T07:00:00Z',
    ...overrides,
  };
}

function renderPage(): void {
  render(
    <MemoryRouter>
      <ToastProvider>
        <PairingPage />
      </ToastProvider>
    </MemoryRouter>
  );
}

describe('PairingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mockListInstances.mockResolvedValue([buildInstance()]);
    mockValidateInstance.mockResolvedValue({ ok: true, status: 'ok', message: '连接成功' });
    mockCreateInstance.mockResolvedValue(buildInstance({ id: 'inst-created' }));
    mockValidateInstanceByPairCode.mockResolvedValue({ ok: true, status: 'ok', message: '配对码可用' });
    mockCreateInstanceByPairCode.mockResolvedValue(buildInstance({ id: 'inst-created-by-code', name: 'claw2-code' }));
    mockDeleteInstance.mockResolvedValue({ deleted: true });
  });

  it('renders sidebar and instance detail panel, and allows setting current instance', async () => {
    window.localStorage.setItem('linpo.currentInstanceId', 'inst-other');
    renderPage();
    await waitFor(() => {
      expect(mockListInstances).toHaveBeenCalled();
    });

    expect(screen.getByText('实例')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建配对' })).toBeInTheDocument();
    expect(screen.getAllByText('claw2').length).toBeGreaterThan(0);
    expect(screen.getByText('http://127.0.0.1:28789')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '设为当前实例' }));
    expect(window.localStorage.getItem('linpo.currentInstanceId')).toBe('inst-1');
  });

  it('supports token pairing tab validate and create', async () => {
    mockListInstances.mockResolvedValueOnce([]).mockResolvedValueOnce([buildInstance({ id: 'inst-created' })]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '新建配对' })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: '新建配对' }));
    await userEvent.clear(screen.getByLabelText('实例名称'));
    await userEvent.type(screen.getByLabelText('实例名称'), 'claw2');
    await userEvent.clear(screen.getByLabelText('OpenClaw Endpoint'));
    await userEvent.type(screen.getByLabelText('OpenClaw Endpoint'), 'http://127.0.0.1:28789');
    await userEvent.type(screen.getByLabelText('Gateway Token'), 'token-abc');

    await userEvent.click(screen.getByRole('button', { name: '测试连接' }));
    await waitFor(() => {
      expect(mockValidateInstance).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText('连接成功')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '创建实例' }));
    await waitFor(() => {
      expect(mockCreateInstance).toHaveBeenCalledTimes(1);
    });
    expect(window.localStorage.getItem('linpo.currentInstanceId')).toBe('inst-created');
  });

  it('supports pair-code tab validate and create', async () => {
    mockListInstances.mockResolvedValueOnce([]).mockResolvedValueOnce([buildInstance({ id: 'inst-created-by-code', name: 'claw2-code' })]);
    renderPage();
    await screen.findByRole('button', { name: '新建配对' });
    await userEvent.click(screen.getByRole('button', { name: '新建配对' }));
    await userEvent.click(screen.getByRole('tab', { name: '配对码配对' }));

    await userEvent.clear(screen.getByLabelText('实例名称'));
    await userEvent.type(screen.getByLabelText('实例名称'), 'claw2-code');
    await userEvent.type(screen.getByLabelText('配对码'), 'LP1.abc.xyz');

    await userEvent.click(screen.getByRole('button', { name: '校验配对码' }));
    await waitFor(() => {
      expect(mockValidateInstanceByPairCode).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText('配对码可用')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '创建实例' }));
    await waitFor(() => {
      expect(mockCreateInstanceByPairCode).toHaveBeenCalledTimes(1);
    });
    expect(window.localStorage.getItem('linpo.currentInstanceId')).toBe('inst-created-by-code');
  });
});
