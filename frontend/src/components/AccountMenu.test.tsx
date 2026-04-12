import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';

const mockResolveSingleInstance = vi.fn();
const mockGetInstanceTokenUsage = vi.fn();

vi.mock('../api/instanceClient', () => ({
  resolveSingleInstance: (...args: unknown[]) => mockResolveSingleInstance(...args),
  getInstanceTokenUsage: (...args: unknown[]) => mockGetInstanceTokenUsage(...args),
}));

import { AccountMenu } from './AccountMenu';

function renderMenu(): void {
  render(
    <MemoryRouter>
      <AccountMenu triggerVariant="icon" />
    </MemoryRouter>
  );
}

describe('AccountMenu instance info menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveSingleInstance.mockResolvedValue({
      instance: {
        id: 'inst-1',
        name: 'claw1',
        type: 'openclaw',
        endpoint: 'http://127.0.0.1:8000',
        status: 'healthy',
        last_check_at: null,
        created_at: '2026-04-09T00:00:00Z',
      },
      total: 1,
    });
    mockGetInstanceTokenUsage.mockResolvedValue({
      days: 7,
      today: {
        date: '2026-04-11',
        input_tokens: 700,
        output_tokens: 500,
        total_tokens: 1200,
      },
      daily: [
        { date: '2026-04-05', input_tokens: 50, output_tokens: 30, total_tokens: 80 },
        { date: '2026-04-06', input_tokens: 80, output_tokens: 40, total_tokens: 120 },
        { date: '2026-04-07', input_tokens: 110, output_tokens: 50, total_tokens: 160 },
        { date: '2026-04-08', input_tokens: 130, output_tokens: 60, total_tokens: 190 },
        { date: '2026-04-09', input_tokens: 120, output_tokens: 55, total_tokens: 175 },
        { date: '2026-04-10', input_tokens: 100, output_tokens: 45, total_tokens: 145 },
        { date: '2026-04-11', input_tokens: 700, output_tokens: 500, total_tokens: 1200 },
      ],
    });
  });

  it('renders instance name on trigger', async () => {
    renderMenu();

    expect(await screen.findByRole('button', { name: '打开实例信息' })).toHaveTextContent('claw1');
  });

  it('opens instance detail menu', async () => {
    renderMenu();

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: '打开实例信息' }));
    });

    expect(screen.getByRole('menu', { name: '实例信息' })).toBeInTheDocument();
    expect(screen.getByText('当前 OpenClaw 实例')).toBeInTheDocument();
    expect(screen.getByText('http://127.0.0.1:8000')).toBeInTheDocument();
    expect(screen.getByText(/总 1,200/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '最近7天Token用量曲线' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '刷新实例信息' })).toBeInTheDocument();
    expect(mockGetInstanceTokenUsage).toHaveBeenCalledWith('inst-1', { days: 7 });
  });

  it('shows not configured state when no instance exists', async () => {
    mockResolveSingleInstance.mockResolvedValueOnce({ instance: null, total: 0 });
    renderMenu();

    expect(await screen.findByRole('button', { name: '打开实例信息' })).toHaveTextContent('未配置实例');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '打开实例信息' }));
    });

    expect(screen.getByText('未检测到实例，请先在服务端配置 1 个 OpenClaw 实例。')).toBeInTheDocument();
    expect(mockGetInstanceTokenUsage).not.toHaveBeenCalled();
  });

  it('shows friendly token usage error when backend returns 503', async () => {
    mockGetInstanceTokenUsage.mockRejectedValueOnce(new ApiError(503, 'Service Unavailable'));
    renderMenu();

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: '打开实例信息' }));
    });

    expect(screen.getAllByText('读取失败：Token 用量服务暂不可用（503）').length).toBeGreaterThan(0);
  });
});
