import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FlowCanvasEdge, FlowCanvasNode } from '../api/types';
import { useBlockedFlowAutoSync } from './useBlockedFlowAutoSync';

function makeNode(id: string): FlowCanvasNode {
  return {
    id,
    title: id,
    description: '',
    depends_on: [],
    x: 20,
    y: 20,
    layer: 1,
    sensitive: false,
    status: 'queued',
    agent_id: null,
  };
}

function makeEdge(source: string, target: string): FlowCanvasEdge {
  return {
    id: `${source}-${target}`,
    source,
    target,
  };
}

type ProbeProps = {
  activeSubmittedRequirementId: string;
  flowDisplayName: string;
  flowNodes: FlowCanvasNode[];
  flowEdges: FlowCanvasEdge[];
  flowRuntimeState: 'idle' | 'running' | 'blocked';
  isPlanning: boolean;
  isFlowActioning: boolean;
  isSubmittingFlow: boolean;
  boardId: string;
  syncRequirement: (requirementId: string, payload: {
    requirement_title: string;
    nodes: FlowCanvasNode[];
    edges: FlowCanvasEdge[];
  }, boardId: string) => Promise<unknown>;
  refreshFlowTasks: () => Promise<unknown>;
  addToast: (message: string, type: 'error' | 'warning' | 'success') => void;
};

function Probe(props: ProbeProps): null {
  useBlockedFlowAutoSync(props);
  return null;
}

describe('useBlockedFlowAutoSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces blocked flow sync and refreshes tasks after success', async () => {
    const syncRequirement = vi.fn().mockResolvedValue(undefined);
    const refreshFlowTasks = vi.fn().mockResolvedValue(undefined);
    const addToast = vi.fn();

    render(
      <Probe
        activeSubmittedRequirementId="req-1"
        flowDisplayName="流程A"
        flowNodes={[makeNode('node-a')]}
        flowEdges={[]}
        flowRuntimeState="blocked"
        isPlanning={false}
        isFlowActioning={false}
        isSubmittingFlow={false}
        boardId="board-1"
        syncRequirement={syncRequirement}
        refreshFlowTasks={refreshFlowTasks}
        addToast={addToast}
      />
    );

    expect(syncRequirement).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(280);
    });
    await Promise.resolve();

    expect(syncRequirement).toHaveBeenCalledTimes(1);
    expect(syncRequirement).toHaveBeenCalledWith(
      'req-1',
      expect.objectContaining({ requirement_title: '流程A' }),
      'board-1'
    );
    expect(refreshFlowTasks).toHaveBeenCalledTimes(1);
    expect(addToast).not.toHaveBeenCalled();
  });

  it('skips sync while planner/runtime action is in progress', () => {
    const syncRequirement = vi.fn().mockResolvedValue(undefined);
    const refreshFlowTasks = vi.fn().mockResolvedValue(undefined);
    const addToast = vi.fn();

    render(
      <Probe
        activeSubmittedRequirementId="req-1"
        flowDisplayName="流程A"
        flowNodes={[makeNode('node-a')]}
        flowEdges={[]}
        flowRuntimeState="running"
        isPlanning={false}
        isFlowActioning={false}
        isSubmittingFlow={false}
        boardId="board-1"
        syncRequirement={syncRequirement}
        refreshFlowTasks={refreshFlowTasks}
        addToast={addToast}
      />
    );

    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(syncRequirement).not.toHaveBeenCalled();
  });

  it('deduplicates unchanged signatures across rerender', async () => {
    const syncRequirement = vi.fn().mockResolvedValue(undefined);
    const refreshFlowTasks = vi.fn().mockResolvedValue(undefined);
    const addToast = vi.fn();
    const baseProps: ProbeProps = {
      activeSubmittedRequirementId: 'req-1',
      flowDisplayName: '流程A',
      flowNodes: [makeNode('node-a')],
      flowEdges: [makeEdge('node-a', 'node-b')],
      flowRuntimeState: 'blocked',
      isPlanning: false,
      isFlowActioning: false,
      isSubmittingFlow: false,
      boardId: 'board-1',
      syncRequirement,
      refreshFlowTasks,
      addToast,
    };

    const { rerender } = render(<Probe {...baseProps} />);
    act(() => {
      vi.advanceTimersByTime(280);
    });
    await Promise.resolve();
    expect(syncRequirement).toHaveBeenCalledTimes(1);

    rerender(
      <Probe
        {...baseProps}
        flowNodes={[{ ...baseProps.flowNodes[0], depends_on: [...baseProps.flowNodes[0].depends_on] }]}
        flowEdges={[{ ...baseProps.flowEdges[0] }]}
      />
    );
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(syncRequirement).toHaveBeenCalledTimes(1);
  });

  it('does not retrigger sync for same signature while first sync is in-flight', async () => {
    let resolveSync: (() => void) | undefined;
    const syncRequirement = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => {
        resolveSync = resolve;
      })
    );
    const refreshFlowTasks = vi.fn().mockResolvedValue(undefined);
    const addToast = vi.fn();
    const baseProps: ProbeProps = {
      activeSubmittedRequirementId: 'req-1',
      flowDisplayName: '流程A',
      flowNodes: [makeNode('node-a')],
      flowEdges: [makeEdge('node-a', 'node-b')],
      flowRuntimeState: 'blocked',
      isPlanning: false,
      isFlowActioning: false,
      isSubmittingFlow: false,
      boardId: 'board-1',
      syncRequirement,
      refreshFlowTasks,
      addToast,
    };

    const { rerender } = render(<Probe {...baseProps} />);
    act(() => {
      vi.advanceTimersByTime(280);
    });
    await Promise.resolve();

    expect(syncRequirement).toHaveBeenCalledTimes(1);

    rerender(
      <Probe
        {...baseProps}
        flowNodes={[{ ...baseProps.flowNodes[0], depends_on: [...baseProps.flowNodes[0].depends_on] }]}
        flowEdges={[{ ...baseProps.flowEdges[0] }]}
      />
    );
    act(() => {
      vi.advanceTimersByTime(300);
    });
    await Promise.resolve();

    expect(syncRequirement).toHaveBeenCalledTimes(1);

    if (resolveSync) {
      resolveSync();
    }
    await Promise.resolve();
    await Promise.resolve();

    expect(refreshFlowTasks).toHaveBeenCalledTimes(1);
  });

  it('shows error toast when sync fails', async () => {
    const syncRequirement = vi.fn().mockRejectedValue(new Error('sync-failed'));
    const refreshFlowTasks = vi.fn().mockResolvedValue(undefined);
    const addToast = vi.fn();

    render(
      <Probe
        activeSubmittedRequirementId="req-1"
        flowDisplayName="流程A"
        flowNodes={[makeNode('node-a')]}
        flowEdges={[]}
        flowRuntimeState="blocked"
        isPlanning={false}
        isFlowActioning={false}
        isSubmittingFlow={false}
        boardId="board-1"
        syncRequirement={syncRequirement}
        refreshFlowTasks={refreshFlowTasks}
        addToast={addToast}
      />
    );

    await act(async () => {
      vi.advanceTimersByTime(280);
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(syncRequirement).toHaveBeenCalledTimes(1);
    expect(addToast).toHaveBeenCalledWith('sync-failed', 'error');
    expect(refreshFlowTasks).not.toHaveBeenCalled();
  });
});
