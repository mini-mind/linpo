import { useCallback } from 'react';

import type { FlowRouteHydrationApplyIntent } from '../components/flowRouteHydrationUtils';
import type { FlowDraftRecord } from '../components/flowDraftStore';
import type { FlowLane, FlowSnapshot } from '../components/flowPageUtils';

type UseFlowRouteHydrationApplyOptions = {
  applyDraftRecord: (draft: FlowDraftRecord) => void;
  applyEmptyDraftCanvasState: (params: {
    flowId: string;
    flowDisplayName: string;
    flowNameInput: string;
    flowRequirement: string;
    lanes: FlowLane[];
    selectedExecutorAgentId: string;
  }) => void;
  applySnapshot: (snapshot: FlowSnapshot) => void;
  applySnapshotCanvasState: (snapshot: FlowSnapshot) => void;
  setLoadedRouteKey: (key: string) => void;
};

export function useFlowRouteHydrationApply(options: UseFlowRouteHydrationApplyOptions): {
  applyFlowRouteHydrationIntent: (intent: FlowRouteHydrationApplyIntent) => void;
} {
  const {
    applyDraftRecord,
    applyEmptyDraftCanvasState,
    applySnapshot,
    applySnapshotCanvasState,
    setLoadedRouteKey,
  } = options;

  const applyFlowRouteHydrationIntent = useCallback((intent: FlowRouteHydrationApplyIntent) => {
    switch (intent.action) {
      case 'apply_draft':
        applyDraftRecord(intent.draft);
        break;
      case 'apply_empty_draft':
        applyEmptyDraftCanvasState(intent.state);
        break;
      case 'apply_snapshot':
        applySnapshot(intent.snapshot);
        break;
      case 'apply_snapshot_canvas':
        applySnapshotCanvasState(intent.snapshot);
        break;
      case 'noop':
      default:
        break;
    }
    if (intent.shouldSetLoadedRouteKey && intent.nextLoadedRouteKey !== null) {
      setLoadedRouteKey(intent.nextLoadedRouteKey);
    }
  }, [applyDraftRecord, applyEmptyDraftCanvasState, applySnapshot, applySnapshotCanvasState, setLoadedRouteKey]);

  return {
    applyFlowRouteHydrationIntent,
  };
}
