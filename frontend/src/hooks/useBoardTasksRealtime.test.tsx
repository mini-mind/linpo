import { act, render } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { BoardRealtimeSseClientOptions } from '../api/realtimeClient';
import { useBoardTasksRealtime } from './useBoardTasksRealtime';

const { mockCreateBoardTasksSseClient } = vi.hoisted(() => ({
  mockCreateBoardTasksSseClient: vi.fn(),
}));

vi.mock('../api/realtimeClient', async () => {
  const actual = await vi.importActual<typeof import('../api/realtimeClient')>('../api/realtimeClient');
  return {
    ...actual,
    createBoardTasksSseClient: mockCreateBoardTasksSseClient,
  };
});

type ClientRecord = {
  connect: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  options: BoardRealtimeSseClientOptions;
};

function HookHarness(props: {
  boardId: string;
  enabled?: boolean;
  onReconnect?: () => Promise<void> | void;
}): null {
  useBoardTasksRealtime({
    boardId: props.boardId,
    enabled: props.enabled,
    onMessage: () => {},
    onReconnect: props.onReconnect,
  });
  return null;
}

describe('useBoardTasksRealtime', () => {
  const clients: ClientRecord[] = [];

  beforeEach(() => {
    clients.length = 0;
    vi.useFakeTimers();
    mockCreateBoardTasksSseClient.mockReset();
    mockCreateBoardTasksSseClient.mockImplementation((options: BoardRealtimeSseClientOptions) => {
      const record: ClientRecord = {
        connect: vi.fn(),
        close: vi.fn(),
        options,
      };
      clients.push(record);
      return {
        connect: record.connect,
        close: record.close,
      };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('connects on mount and closes on unmount', () => {
    const view = render(<HookHarness boardId="default" />);
    expect(clients).toHaveLength(1);
    expect(clients[0].connect).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(clients[0].close).toHaveBeenCalledTimes(1);
  });

  it('refreshes then reconnects after disconnect backoff', async () => {
    const onReconnect = vi.fn().mockResolvedValue(undefined);
    render(<HookHarness boardId="default" onReconnect={onReconnect} />);

    act(() => {
      clients[0].options.onDisconnected?.();
    });

    expect(onReconnect).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(400);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(clients).toHaveLength(2);
    expect(clients[1].connect).toHaveBeenCalledTimes(1);
  });
});
