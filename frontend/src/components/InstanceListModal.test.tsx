import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockListInstances = vi.fn();
const mockCreateInstance = vi.fn();
const mockCreatePairingSession = vi.fn();
const mockGetPairingSession = vi.fn();
const mockValidateInstance = vi.fn();
const mockGetAggregateTopology = vi.fn();
const mockAddToast = vi.fn();

vi.mock('../api/instanceClient', () => ({
  listInstances: (...args: unknown[]) => mockListInstances(...args),
  createInstance: (...args: unknown[]) => mockCreateInstance(...args),
  createPairingSession: (...args: unknown[]) => mockCreatePairingSession(...args),
  getPairingSession: (...args: unknown[]) => mockGetPairingSession(...args),
  validateInstance: (...args: unknown[]) => mockValidateInstance(...args),
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

async function waitForInstanceListReady(): Promise<void> {
  await screen.findByRole('button', { name: /^claw1/ });
}

describe('InstanceListModal', () => {
  beforeEach(() => {
    mockListInstances.mockReset();
    mockCreateInstance.mockReset();
    mockCreatePairingSession.mockReset();
    mockGetPairingSession.mockReset();
    mockValidateInstance.mockReset();
    mockGetAggregateTopology.mockReset();
    mockAddToast.mockReset();
    window.localStorage.clear();
    window.sessionStorage.clear();
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
    mockValidateInstance.mockResolvedValue({ ok: true, status: 'ok', message: '连接成功' });
    mockCreatePairingSession.mockResolvedValue({
      sessionId: 'session-1',
      name: 'claw2',
      shortCode: 'ABCD-1234',
      pairingUrl: 'linpo://pair?code=ABCD-1234',
      status: 'pending',
      expiresAt: '2026-04-04T02:00:00Z',
      instanceId: null,
      instance: null,
    });
    mockGetPairingSession.mockResolvedValue({
      sessionId: 'session-1',
      name: 'claw2',
      shortCode: 'ABCD-1234',
      pairingUrl: 'linpo://pair?code=ABCD-1234',
      status: 'pending',
      expiresAt: '2026-04-04T02:00:00Z',
      instanceId: null,
      instance: null,
    });
  });

  it('creates pairing session by default and switches to bound instance automatically', async () => {
    mockGetPairingSession
      .mockResolvedValueOnce({
        sessionId: 'session-1',
        name: 'claw2',
        shortCode: 'ABCD-1234',
        pairingUrl: 'linpo://pair?code=ABCD-1234',
        status: 'pending',
        expiresAt: '2026-04-04T02:00:00Z',
        instanceId: null,
        instance: null,
      })
      .mockResolvedValueOnce({
        sessionId: 'session-1',
        name: 'claw2',
        shortCode: 'ABCD-1234',
        pairingUrl: 'linpo://pair?code=ABCD-1234',
        status: 'bound',
        expiresAt: '2026-04-04T02:00:00Z',
        instanceId: 'inst-2',
        instance: {
          id: 'inst-2',
          name: 'claw2',
          type: 'openclaw',
          endpoint: 'http://127.0.0.1:28789',
          status: 'ok',
          last_check_at: null,
          created_at: '2026-04-03T00:00:00Z',
        },
      })
      .mockResolvedValue({
        sessionId: 'session-1',
        name: 'claw2',
        shortCode: 'ABCD-1234',
        pairingUrl: 'linpo://pair?code=ABCD-1234',
        status: 'bound',
        expiresAt: '2026-04-04T02:00:00Z',
        instanceId: 'inst-2',
        instance: {
          id: 'inst-2',
          name: 'claw2',
          type: 'openclaw',
          endpoint: 'http://127.0.0.1:28789',
          status: 'ok',
          last_check_at: null,
          created_at: '2026-04-03T00:00:00Z',
        },
      });

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(<InstanceListModal open onClose={() => undefined} />);

    await screen.findByRole('dialog', { name: '实例列表' });
    await waitForInstanceListReady();
    fireEvent.click(screen.getByRole('button', { name: '添加实例' }));

    expect(screen.getByRole('tab', { name: '配对会话' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByLabelText('OpenClaw Endpoint')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Gateway Token')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('实例名称'), { target: { value: 'claw2' } });
    fireEvent.click(screen.getByRole('button', { name: '创建配对会话' }));

    await waitFor(() => {
      expect(mockCreatePairingSession).toHaveBeenCalledWith({
        name: 'claw2',
        expSeconds: 600,
      });
    });
    await waitFor(() => {
      expect(screen.getByLabelText('给 OpenClaw 的一键指令')).toBeInTheDocument();
    });
    expect((screen.getByLabelText('给 OpenClaw 的一键指令') as HTMLTextAreaElement).value).toContain(
      '/docs/openclaw-pairing-session-guide.md'
    );
    expect((screen.getByLabelText('给 OpenClaw 的一键指令') as HTMLTextAreaElement).value).toContain(
      'shortCode=ABCD-1234'
    );
    fireEvent.click(screen.getByRole('button', { name: '复制一键指令' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/docs/openclaw-pairing-session-guide.md'));
    });
    await waitFor(() => {
      expect(mockGetPairingSession).toHaveBeenCalledWith('session-1');
    });
    await waitFor(() => {
      expect(screen.getAllByText('claw2').length).toBeGreaterThan(0);
      expect(mockAddToast).toHaveBeenCalledWith('配对成功，已切换到新实例', 'success');
    });
  });

  it('falls back to execCommand copy when clipboard API is unavailable', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('clipboard blocked'));
    const execCommandMock = vi.fn().mockReturnValue(true);
    mockGetPairingSession.mockResolvedValue({
      sessionId: 'session-1',
      name: 'claw2',
      shortCode: 'ABCD-1234',
      pairingUrl: 'linpo://pair?code=ABCD-1234',
      status: 'pending',
      expiresAt: '2026-04-04T02:00:00Z',
      instanceId: null,
      instance: null,
    });
    Object.defineProperty(document, 'execCommand', {
      value: execCommandMock,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(<InstanceListModal open onClose={() => undefined} />);

    await screen.findByRole('dialog', { name: '实例列表' });
    await waitForInstanceListReady();
    await userEvent.click(screen.getByRole('button', { name: '添加实例' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '创建配对会话' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('tab', { name: '配对会话' }));
    fireEvent.change(screen.getByLabelText('实例名称'), { target: { value: 'claw2' } });
    fireEvent.click(screen.getByRole('button', { name: '创建配对会话' }));

    await waitFor(() => {
      expect(screen.getByLabelText('给 OpenClaw 的一键指令')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '复制一键指令' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: '复制一键指令' }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
      expect(execCommandMock).toHaveBeenCalledWith('copy');
      expect(mockAddToast).toHaveBeenCalledWith('一键指令已复制', 'success');
    });
    expect(mockAddToast).not.toHaveBeenCalledWith('复制失败，请手动复制', 'error');
  });

  it('creates claw2 instance from token tab', async () => {
    render(<InstanceListModal open onClose={() => undefined} />);

    await screen.findByRole('dialog', { name: '实例列表' });
    await waitForInstanceListReady();
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

});
