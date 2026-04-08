import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FlowPlannerSseClientOptions } from '../api/realtimeClient';
import { useFlowPlannerRealtime } from './useFlowPlannerRealtime';

const {
  mockProbeFlowPlannerSession,
  mockCreateFlowPlannerSseClient,
} = vi.hoisted(() => ({
  mockProbeFlowPlannerSession: vi.fn(),
  mockCreateFlowPlannerSseClient: vi.fn(),
}));

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    probeFlowPlannerSession: mockProbeFlowPlannerSession,
  };
});

vi.mock('../api/realtimeClient', async () => {
  const actual = await vi.importActual<typeof import('../api/realtimeClient')>('../api/realtimeClient');
  return {
    ...actual,
    createFlowPlannerSseClient: mockCreateFlowPlannerSseClient,
  };
});

type ClientRecord = {
  connect: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  options: FlowPlannerSseClientOptions;
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advanceReconnectDelay(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

function HookHarness(props: {
  sessionKey: string | null;
  enabled?: boolean;
  onStaleSession?: (sessionKey: string) => void;
}): null {
  useFlowPlannerRealtime({
    boardId: 'default',
    sessionKey: props.sessionKey,
    enabled: props.enabled,
    onMessage: () => {},
    onStaleSession: props.onStaleSession ?? (() => {}),
    shouldTreatProbeErrorAsStale: (error) => error instanceof Error && error.message === 'not-found',
  });
  return null;
}

describe('useFlowPlannerRealtime', () => {
  const clients: ClientRecord[] = [];

  beforeEach(() => {
    clients.length = 0;
    vi.useFakeTimers();
    mockProbeFlowPlannerSession.mockReset();
    mockCreateFlowPlannerSseClient.mockReset();
    mockCreateFlowPlannerSseClient.mockImplementation((options: FlowPlannerSseClientOptions) => {
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

  it('probes and connects planner realtime when session exists', async () => {
    mockProbeFlowPlannerSession.mockResolvedValue({ exists: true });
    render(<HookHarness sessionKey="planner-session-1" />);

    await flushEffects();

    expect(mockProbeFlowPlannerSession).toHaveBeenCalledWith('planner-session-1', undefined, 'default');
    expect(clients).toHaveLength(1);
    expect(clients[0].connect).toHaveBeenCalledTimes(1);
  });

  it('marks stale session when probe says missing and does not connect', async () => {
    mockProbeFlowPlannerSession.mockResolvedValue({ exists: false });
    const onStaleSession = vi.fn();
    render(<HookHarness sessionKey="planner-missing" onStaleSession={onStaleSession} />);

    await flushEffects();

    expect(onStaleSession).toHaveBeenCalledWith('planner-missing');
    expect(clients).toHaveLength(0);
  });

  it('reconnects with backoff after disconnect', async () => {
    mockProbeFlowPlannerSession.mockResolvedValue({ exists: true });
    render(<HookHarness sessionKey="planner-session-2" />);
    await flushEffects();
    expect(clients).toHaveLength(1);

    act(() => {
      clients[0].options.onDisconnected?.();
    });

    await advanceReconnectDelay(400);
    expect(clients).toHaveLength(2);
    expect(clients[1].connect).toHaveBeenCalledTimes(1);
  });

  it('treats probe error as stale when shouldTreatProbeErrorAsStale returns true', async () => {
    mockProbeFlowPlannerSession.mockRejectedValue(new Error('not-found'));
    const onStaleSession = vi.fn();
    render(<HookHarness sessionKey="planner-probe-error-stale" onStaleSession={onStaleSession} />);

    await flushEffects();

    expect(onStaleSession).toHaveBeenCalledWith('planner-probe-error-stale');
    expect(clients).toHaveLength(0);
  });

  it('does not treat probe error as stale when shouldTreatProbeErrorAsStale returns false', async () => {
    mockProbeFlowPlannerSession.mockRejectedValue(new Error('network-error'));
    const onStaleSession = vi.fn();
    render(<HookHarness sessionKey="planner-probe-error-connect" onStaleSession={onStaleSession} />);

    await flushEffects();

    expect(onStaleSession).not.toHaveBeenCalled();
    expect(clients).toHaveLength(1);
    expect(clients[0].connect).toHaveBeenCalledTimes(1);
  });

  it('ignores old session probe result after sessionKey switches', async () => {
    const firstProbe = deferred<{ exists: boolean }>();
    const secondProbe = deferred<{ exists: boolean }>();
    mockProbeFlowPlannerSession
      .mockImplementationOnce(() => firstProbe.promise)
      .mockImplementationOnce(() => secondProbe.promise);
    const onStaleSession = vi.fn();
    const view = render(<HookHarness sessionKey="planner-old-session" onStaleSession={onStaleSession} />);

    view.rerender(<HookHarness sessionKey="planner-new-session" onStaleSession={onStaleSession} />);

    await flushEffects();
    await act(async () => {
      secondProbe.resolve({ exists: true });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(clients).toHaveLength(1);
    expect(clients[0].options.sessionKey).toBe('planner-new-session');
    expect(clients[0].connect).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstProbe.resolve({ exists: false });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(clients).toHaveLength(1);
    expect(onStaleSession).not.toHaveBeenCalledWith('planner-old-session');
    expect(onStaleSession).not.toHaveBeenCalledWith('planner-new-session');
  });

  it('does not reconnect old session after timer was scheduled then sessionKey switches', async () => {
    mockProbeFlowPlannerSession.mockResolvedValue({ exists: true });
    const view = render(<HookHarness sessionKey="planner-old-session" />);

    await flushEffects();

    expect(clients).toHaveLength(1);
    expect(clients[0].options.sessionKey).toBe('planner-old-session');

    act(() => {
      clients[0].options.onDisconnected?.();
    });

    view.rerender(<HookHarness sessionKey="planner-new-session" />);

    await flushEffects();

    expect(clients).toHaveLength(2);
    expect(clients[1].options.sessionKey).toBe('planner-new-session');
    expect(clients[1].connect).toHaveBeenCalledTimes(1);

    await advanceReconnectDelay(400);

    expect(clients).toHaveLength(2);
    expect(clients.filter((client) => client.options.sessionKey === 'planner-old-session')).toHaveLength(1);
  });

  it('does not reconnect session after timer was scheduled then hook is disabled', async () => {
    mockProbeFlowPlannerSession.mockResolvedValue({ exists: true });
    const view = render(<HookHarness sessionKey="planner-session-disable" enabled />);

    await flushEffects();

    expect(clients).toHaveLength(1);
    expect(clients[0].connect).toHaveBeenCalledTimes(1);

    act(() => {
      clients[0].options.onDisconnected?.();
    });

    view.rerender(<HookHarness sessionKey="planner-session-disable" enabled={false} />);

    await flushEffects();

    await advanceReconnectDelay(400);

    expect(clients).toHaveLength(1);
    expect(clients[0].close).toHaveBeenCalledTimes(1);
    expect(mockProbeFlowPlannerSession).toHaveBeenCalledTimes(1);
  });

  it('does not connect when probe resolves after hook unmounts', async () => {
    const probe = deferred<{ exists: boolean }>();
    mockProbeFlowPlannerSession.mockImplementationOnce(() => probe.promise);
    const view = render(<HookHarness sessionKey="planner-unmount-probe-connect" />);

    view.unmount();

    await act(async () => {
      probe.resolve({ exists: true });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(clients).toHaveLength(0);
  });

  it('does not mark stale when probe resolves missing after hook unmounts', async () => {
    const probe = deferred<{ exists: boolean }>();
    mockProbeFlowPlannerSession.mockImplementationOnce(() => probe.promise);
    const onStaleSession = vi.fn();
    const view = render(
      <HookHarness sessionKey="planner-unmount-probe-stale" onStaleSession={onStaleSession} />,
    );

    view.unmount();

    await act(async () => {
      probe.resolve({ exists: false });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onStaleSession).not.toHaveBeenCalled();
    expect(clients).toHaveLength(0);
  });

  it('does not reconnect when timer was scheduled then hook unmounts', async () => {
    mockProbeFlowPlannerSession.mockResolvedValue({ exists: true });
    const view = render(<HookHarness sessionKey="planner-unmount-reconnect" />);

    await flushEffects();

    expect(clients).toHaveLength(1);
    act(() => {
      clients[0].options.onDisconnected?.();
    });

    view.unmount();

    await advanceReconnectDelay(400);

    expect(clients).toHaveLength(1);
    expect(clients[0].close).toHaveBeenCalledTimes(1);
  });
});
