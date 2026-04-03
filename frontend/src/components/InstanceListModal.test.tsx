import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockListInstances = vi.fn();
const mockCreateInstance = vi.fn();
const mockGetAggregateTopology = vi.fn();
const mockAddToast = vi.fn();

vi.mock('../api/instanceClient', () => ({
  listInstances: (...args: unknown[]) => mockListInstances(...args),
  createInstance: (...args: unknown[]) => mockCreateInstance(...args),
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
  });

  it('creates instance from modal add form', async () => {
    render(<InstanceListModal open onClose={() => undefined} />);

    await screen.findByRole('dialog', { name: '实例列表' });
    fireEvent.click(screen.getByRole('button', { name: '添加实例' }));

    fireEvent.change(screen.getByLabelText('实例名称'), { target: { value: 'claw2' } });
    fireEvent.change(screen.getByLabelText('OpenClaw Endpoint'), { target: { value: 'http://127.0.0.1:28789' } });
    fireEvent.change(screen.getByLabelText('Gateway Token'), { target: { value: 'token-abc' } });
    fireEvent.click(screen.getByRole('button', { name: '创建实例' }));

    await waitFor(() => {
      expect(mockCreateInstance).toHaveBeenCalledWith({
        name: 'claw2',
        type: 'openclaw',
        endpoint: 'http://127.0.0.1:28789',
        gatewayToken: 'token-abc',
      });
    });
    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('创建成功：claw2', 'success');
    });
    expect(screen.getByRole('button', { name: /claw2/ })).toBeInTheDocument();
  });
});
