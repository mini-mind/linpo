import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { FlowRouteHydrationApplyIntent } from '../components/flowRouteHydrationUtils';
import { useFlowRouteHydrationApply } from './useFlowRouteHydrationApply';

describe('useFlowRouteHydrationApply', () => {
  it('applies empty draft intent and writes loaded route key', () => {
    const applyDraftRecord = vi.fn();
    const applyEmptyDraftCanvasState = vi.fn();
    const applySnapshot = vi.fn();
    const applySnapshotCanvasState = vi.fn();
    const setLoadedRouteKey = vi.fn();
    const runtimeHolder: { applyFlowRouteHydrationIntent: ((intent: FlowRouteHydrationApplyIntent) => void) | null } = {
      applyFlowRouteHydrationIntent: null,
    };

    function Probe(): null {
      const runtime = useFlowRouteHydrationApply({
        applyDraftRecord,
        applyEmptyDraftCanvasState,
        applySnapshot,
        applySnapshotCanvasState,
        setLoadedRouteKey,
      });
      runtimeHolder.applyFlowRouteHydrationIntent = runtime.applyFlowRouteHydrationIntent;
      return null;
    }

    render(<Probe />);
    const applyFlowRouteHydrationIntent = runtimeHolder.applyFlowRouteHydrationIntent;
    if (!applyFlowRouteHydrationIntent) {
      throw new Error('hook not initialized');
    }

    applyFlowRouteHydrationIntent({
      action: 'apply_empty_draft',
      shouldSetLoadedRouteKey: true,
      nextLoadedRouteKey: 'new:draft-1',
      state: {
        flowId: 'draft-1',
        flowDisplayName: '未命名流程',
        flowNameInput: '未命名流程',
        flowRequirement: '',
        lanes: [],
        selectedExecutorAgentId: '',
      },
    });

    expect(applyEmptyDraftCanvasState).toHaveBeenCalledTimes(1);
    expect(applyEmptyDraftCanvasState).toHaveBeenCalledWith({
      flowId: 'draft-1',
      flowDisplayName: '未命名流程',
      flowNameInput: '未命名流程',
      flowRequirement: '',
      lanes: [],
      selectedExecutorAgentId: '',
    });
    expect(setLoadedRouteKey).toHaveBeenCalledWith('new:draft-1');
    expect(applyDraftRecord).not.toHaveBeenCalled();
    expect(applySnapshot).not.toHaveBeenCalled();
    expect(applySnapshotCanvasState).not.toHaveBeenCalled();
  });

  it('does nothing for noop intent without route key update', () => {
    const applyDraftRecord = vi.fn();
    const applyEmptyDraftCanvasState = vi.fn();
    const applySnapshot = vi.fn();
    const applySnapshotCanvasState = vi.fn();
    const setLoadedRouteKey = vi.fn();
    const runtimeHolder: { applyFlowRouteHydrationIntent: ((intent: FlowRouteHydrationApplyIntent) => void) | null } = {
      applyFlowRouteHydrationIntent: null,
    };

    function Probe(): null {
      const runtime = useFlowRouteHydrationApply({
        applyDraftRecord,
        applyEmptyDraftCanvasState,
        applySnapshot,
        applySnapshotCanvasState,
        setLoadedRouteKey,
      });
      runtimeHolder.applyFlowRouteHydrationIntent = runtime.applyFlowRouteHydrationIntent;
      return null;
    }

    render(<Probe />);
    const applyFlowRouteHydrationIntent = runtimeHolder.applyFlowRouteHydrationIntent;
    if (!applyFlowRouteHydrationIntent) {
      throw new Error('hook not initialized');
    }

    applyFlowRouteHydrationIntent({
      action: 'noop',
      shouldSetLoadedRouteKey: false,
      nextLoadedRouteKey: null,
    });

    expect(applyDraftRecord).not.toHaveBeenCalled();
    expect(applyEmptyDraftCanvasState).not.toHaveBeenCalled();
    expect(applySnapshot).not.toHaveBeenCalled();
    expect(applySnapshotCanvasState).not.toHaveBeenCalled();
    expect(setLoadedRouteKey).not.toHaveBeenCalled();
  });
});
