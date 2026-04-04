import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Buffer } from 'node:buffer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockListInstances = vi.fn();
const mockCreateInstance = vi.fn();
const mockCreateInstanceByPairCode = vi.fn();
const mockValidateInstance = vi.fn();
const mockValidateInstanceByPairCode = vi.fn();
const mockGetAggregateTopology = vi.fn();
const mockAddToast = vi.fn();

vi.mock('../api/instanceClient', () => ({
  listInstances: (...args: unknown[]) => mockListInstances(...args),
  createInstance: (...args: unknown[]) => mockCreateInstance(...args),
  createInstanceByPairCode: (...args: unknown[]) => mockCreateInstanceByPairCode(...args),
  validateInstance: (...args: unknown[]) => mockValidateInstance(...args),
  validateInstanceByPairCode: (...args: unknown[]) => mockValidateInstanceByPairCode(...args),
}));

vi.mock('../api/client', () => ({
  getAggregateTopology: (...args: unknown[]) => mockGetAggregateTopology(...args),
}));

vi.mock('../hooks/useIsMobile', () => ({
  useIsMobile: () => false,
}));

vi.mock('../hooks/useToast', () => ({
  useToast: () => ({
    addToast: mockAddToast,
  }),
}));

import { InstanceListModal } from './InstanceListModal';

function encodePairCode(payload: Record<string, string>): string {
  const raw = JSON.stringify(payload);
  return `LP1.${Buffer.from(raw, 'utf-8').toString('base64url')}`;
}

describe('InstanceListModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListInstances
      .mockResolvedValueOnce([
        {
          id: 'inst-1',
          name: 'claw1',
          type: 'openclaw',
          endpoint: 'http://127.0.0.1:18789',
          status: 'ok',
          last_check_at: null,
          created_at: '2026-04-03T00:00:00Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'inst-1',
          name: 'claw1',
          type: 'openclaw',
          endpoint: 'http://127.0.0.1:18789',
          status: 'ok',
          last_check_at: null,
          created_at: '2026-04-03T00:00:00Z',
        },
        {
          id: 'inst-2',
          name: 'claw2',
          type: 'openclaw',
          endpoint: 'http://127.0.0.1:28789',
          status: 'ok',
          last_check_at: null,
          created_at: '2026-04-03T00:00:00Z',
        },
      ]);
    mockGetAggregateTopology.mockResolvedValue({
      agents: [],
      sessions: [],
      diagnostics: [],
    });
    mockCreateInstance.mockResolvedValue({
      id: 'inst-2',
      name: 'claw2',
      type: 'openclaw',
      endpoint: 'http://127.0.0.1:28789',
      status: 'ok',
      last_check_at: null,
      created_at: '2026-04-03T00:00:00Z',
    });
    mockCreateInstanceByPairCode.mockResolvedValue({
      id: 'inst-pair-1',
      name: 'claw1',
      type: 'openclaw',
      endpoint: 'http://127.0.0.1:18789',
      status: 'ok',
      last_check_at: null,
      created_at: '2026-04-03T00:00:00Z',
    });
    mockValidateInstance.mockResolvedValue({ ok: true, status: 'ok', message: '连接成功' });
    mockValidateInstanceByPairCode.mockResolvedValue({ ok: true, status: 'ok', message: '配对码可用' });
  });

  it('creates claw1 instance from pair-code tab by default', async () => {
    render(<InstanceListModal open onClose={() => undefined} />);

    await screen.findByRole('dialog', { name: '实例列表' });
    fireEvent.click(screen.getByRole('button', { name: '添加实例' }));

    expect(screen.getByRole('tab', { name: '配对码' })).toHaveAttribute('aria-selected', 'true');
    const pairCode = encodePairCode({
      endpoint: 'http://127.0.0.1:18789',
      gatewayToken: 'token-claw1',
    });
    fireEvent.change(screen.getByLabelText('实例名称'), { target: { value: 'claw1' } });
    fireEvent.change(screen.getByLabelText('配对码'), { target: { value: pairCode } });
    fireEvent.click(screen.getByRole('button', { name: '创建实例' }));

    await waitFor(() => {
      expect(mockCreateInstanceByPairCode).toHaveBeenCalledWith({
        name: 'claw1',
        type: 'openclaw',
        pairCode,
      });
    });
    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('创建成功：claw1', 'success');
    });
  });

  it('creates claw2 instance from token tab', async () => {
    render(<InstanceListModal open onClose={() => undefined} />);

    await screen.findByRole('dialog', { name: '实例列表' });
    fireEvent.click(screen.getByRole('button', { name: '添加实例' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Token' }));

    fireEvent.change(screen.getByLabelText('实例名称'), { target: { value: 'claw2' } });
    fireEvent.change(screen.getByLabelText('OpenClaw Endpoint'), { target: { value: 'http://127.0.0.1:28789' } });
    fireEvent.change(screen.getByLabelText('Gateway Token'), { target: { value: 'token-claw2' } });
    fireEvent.click(screen.getByRole('button', { name: '创建实例' }));

    await waitFor(() => {
      expect(mockCreateInstance).toHaveBeenCalledWith({
        name: 'claw2',
        type: 'openclaw',
        endpoint: 'http://127.0.0.1:28789',
        gatewayToken: 'token-claw2',
      });
    });
    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('创建成功：claw2', 'success');
    });
  });

  it('shows tutorial-link tab and supports copying tutorial url', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(<InstanceListModal open onClose={() => undefined} />);

    await screen.findByRole('dialog', { name: '实例列表' });
    fireEvent.click(screen.getByRole('button', { name: '添加实例' }));
    fireEvent.click(screen.getByRole('tab', { name: '教程链接配对' }));

    expect(screen.getByLabelText('教程链接')).toHaveValue('http://localhost:3000/pairing/tutorial.md');
    fireEvent.click(screen.getByRole('button', { name: '复制链接' }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('http://localhost:3000/pairing/tutorial.md');
    });
  });
});
