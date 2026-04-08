import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePlannerRuntimeTimers } from './usePlannerRuntimeTimers';

function HookHarness(props: {
  settleTimeoutMs: number;
  setOverlayCloseBlocked: (next: boolean) => void;
}): null {
  usePlannerRuntimeTimers(props);
  return null;
}

describe('usePlannerRuntimeTimers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('schedules overlay unlock after settle timeout', () => {
    const setOverlayCloseBlocked = vi.fn();
    let schedule: (() => void) | null = null;

    function Probe(): null {
      const runtime = usePlannerRuntimeTimers({
        settleTimeoutMs: 120,
        setOverlayCloseBlocked,
      });
      schedule = runtime.schedulePlannerOverlayCloseUnlock;
      return null;
    }

    render(<Probe />);
    act(() => {
      schedule?.();
    });

    expect(setOverlayCloseBlocked).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(setOverlayCloseBlocked).toHaveBeenCalledWith(false);
  });

  it('cleans timers on unmount', () => {
    const setOverlayCloseBlocked = vi.fn();
    const view = render(
      <HookHarness settleTimeoutMs={120} setOverlayCloseBlocked={setOverlayCloseBlocked} />
    );

    view.unmount();
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(setOverlayCloseBlocked).not.toHaveBeenCalled();
  });
});
