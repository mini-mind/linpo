import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useFlowPlannerObserverRealtime } from './useFlowPlannerObserverRealtime';

const {
  mockCreateObserverRealtimeClient,
} = vi.hoisted(() => ({
  mockCreateObserverRealtimeClient: vi.fn(),
}));

vi.mock('../api/realtimeClient', async () => {
  const actual = await vi.importActual<typeof import('../api/realtimeClient')>('../api/realtimeClient');
  return {
    ...actual,
    createObserverRealtimeClient: mockCreateObserverRealtimeClient,
  };
});

function HookHarness(props: {
  sessionKey: string | null;
  sessionInstanceId: string | null;
  enabled?: boolean;
}): null {
  useFlowPlannerObserverRealtime({
    sessionKey: props.sessionKey,
    sessionInstanceId: props.sessionInstanceId,
    enabled: props.enabled,
    onMessagesUpdated: () => ({ kind: 'applied' }),
  });
  return null;
}

describe('useFlowPlannerObserverRealtime', () => {
  it('is disabled and never creates observer client', () => {
    render(<HookHarness sessionKey="planner-session-1" sessionInstanceId="instance-alpha" enabled />);
    expect(mockCreateObserverRealtimeClient).not.toHaveBeenCalled();
  });

  it('remains no-op after rerender parameter changes', () => {
    const view = render(<HookHarness sessionKey={null} sessionInstanceId={null} enabled={false} />);
    view.rerender(<HookHarness sessionKey="planner-session-2" sessionInstanceId="instance-beta" enabled />);
    expect(mockCreateObserverRealtimeClient).not.toHaveBeenCalled();
  });
});
