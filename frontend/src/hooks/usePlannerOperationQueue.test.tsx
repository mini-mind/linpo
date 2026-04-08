import { act, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FlowCanvasNode, FlowPlannerNodeDraft } from '../api/types';
import { usePlannerOperationQueue } from './usePlannerOperationQueue';

function makeNode(overrides: Partial<FlowCanvasNode> & { id: string; title: string }): FlowCanvasNode {
  return {
    id: overrides.id,
    title: overrides.title,
    description: overrides.description ?? '',
    depends_on: overrides.depends_on ?? [],
    x: overrides.x ?? 24,
    y: overrides.y ?? 24,
    layer: overrides.layer ?? 1,
    sensitive: overrides.sensitive ?? false,
    status: overrides.status ?? 'queued',
    agent_id: overrides.agent_id ?? null,
  };
}

function draftToNode(draft: FlowPlannerNodeDraft): FlowCanvasNode {
  return makeNode({
    id: draft.id,
    title: draft.title,
    description: draft.description ?? '',
    depends_on: draft.depends_on ?? [],
    sensitive: draft.sensitive ?? false,
  });
}

describe('usePlannerOperationQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('enqueues and flushes planner operations by step timer', () => {
    const applyDraftNodes = vi.fn();
    let enqueue: ((sessionKey: string, operations: any[]) => void) | null = null;

    const nodesRef: { current: FlowCanvasNode[] } = {
      current: [makeNode({ id: 'node-a', title: 'A' })],
    };

    function Probe(): null {
      const stepTimerRef = useRef<number | null>(null);
      const runtime = usePlannerOperationQueue({
        stepIntervalMs: 80,
        stepTimerRef,
        clearStepTimer: () => {
          if (stepTimerRef.current !== null) {
            window.clearTimeout(stepTimerRef.current);
            stepTimerRef.current = null;
          }
        },
        getCurrentNodes: () => nodesRef.current,
        applyDraftNodes: (draftNodes, sessionKey) => {
          applyDraftNodes(draftNodes, sessionKey);
        },
      });
      enqueue = runtime.enqueuePlannerOperations;
      return null;
    }

    render(<Probe />);
    act(() => {
      enqueue?.('session-a', [{
        type: 'upsert_node',
        node: {
          id: 'node-b',
          title: 'B',
          description: '',
          depends_on: ['node-a'],
          sensitive: false,
        },
      }]);
    });

    act(() => {
      vi.advanceTimersByTime(80);
    });

    expect(applyDraftNodes).toHaveBeenCalledTimes(1);
    const [draftNodes] = applyDraftNodes.mock.calls[0] as [FlowPlannerNodeDraft[], string];
    expect(draftNodes.map((item) => item.id)).toEqual(['node-a', 'node-b']);
  });

  it('queues snapshot while operations are pending then applies snapshot after drain', () => {
    const applyDraftNodes = vi.fn();
    let enqueue: ((sessionKey: string, operations: any[]) => void) | null = null;
    let applyOrQueueSnapshot: ((sessionKey: string, revision: number, nodes: FlowPlannerNodeDraft[]) => boolean) | null = null;

    const nodesRef: { current: FlowCanvasNode[] } = {
      current: [makeNode({ id: 'node-a', title: 'A' })],
    };

    function Probe(): null {
      const stepTimerRef = useRef<number | null>(null);
      const runtime = usePlannerOperationQueue({
        stepIntervalMs: 80,
        stepTimerRef,
        clearStepTimer: () => {
          if (stepTimerRef.current !== null) {
            window.clearTimeout(stepTimerRef.current);
            stepTimerRef.current = null;
          }
        },
        getCurrentNodes: () => nodesRef.current,
        applyDraftNodes: (draftNodes, sessionKey) => {
          applyDraftNodes(draftNodes, sessionKey);
        },
      });
      enqueue = runtime.enqueuePlannerOperations;
      applyOrQueueSnapshot = runtime.applyOrQueuePlannerSnapshot;
      return null;
    }

    render(<Probe />);
    act(() => {
      enqueue?.('session-a', [{
        type: 'upsert_node',
        node: {
          id: 'node-b',
          title: 'B',
          description: '',
          depends_on: [],
          sensitive: false,
        },
      }]);
      const appliedNow = applyOrQueueSnapshot?.('session-a', 2, [{
        id: 'snap-1',
        title: 'Snap',
        description: '',
        depends_on: [],
        sensitive: false,
      }]);
      expect(appliedNow).toBe(false);
    });

    act(() => {
      vi.advanceTimersByTime(80);
    });

    expect(applyDraftNodes).toHaveBeenCalledTimes(2);
    const secondCall = applyDraftNodes.mock.calls[1] as [FlowPlannerNodeDraft[], string];
    expect(secondCall[0].map((item) => item.id)).toEqual(['snap-1']);
  });

  it('does not apply queued operations after runtime is cleared', () => {
    const applyDraftNodes = vi.fn();
    let enqueue: ((sessionKey: string, operations: any[]) => void) | null = null;
    let clearRuntime: (() => void) | null = null;

    const nodesRef: { current: FlowCanvasNode[] } = {
      current: [makeNode({ id: 'node-a', title: 'A' })],
    };

    function Probe(): null {
      const stepTimerRef = useRef<number | null>(null);
      const runtime = usePlannerOperationQueue({
        stepIntervalMs: 80,
        stepTimerRef,
        clearStepTimer: () => {
          if (stepTimerRef.current !== null) {
            window.clearTimeout(stepTimerRef.current);
            stepTimerRef.current = null;
          }
        },
        getCurrentNodes: () => nodesRef.current,
        applyDraftNodes: (draftNodes, sessionKey) => {
          applyDraftNodes(draftNodes, sessionKey);
        },
      });
      enqueue = runtime.enqueuePlannerOperations;
      clearRuntime = runtime.clearPlannerOperationQueueRuntime;
      return null;
    }

    render(<Probe />);
    act(() => {
      enqueue?.('session-clear', [{
        type: 'upsert_node',
        node: {
          id: 'node-b',
          title: 'B',
          description: '',
          depends_on: [],
          sensitive: false,
        },
      }]);
      clearRuntime?.();
    });

    act(() => {
      vi.advanceTimersByTime(240);
    });

    expect(applyDraftNodes).not.toHaveBeenCalled();
  });

  it('applies multiple operations in step order', () => {
    const applyDraftNodes = vi.fn();
    let enqueue: ((sessionKey: string, operations: any[]) => void) | null = null;

    const nodesRef: { current: FlowCanvasNode[] } = {
      current: [makeNode({ id: 'node-a', title: 'A' })],
    };

    function Probe(): null {
      const stepTimerRef = useRef<number | null>(null);
      const runtime = usePlannerOperationQueue({
        stepIntervalMs: 80,
        stepTimerRef,
        clearStepTimer: () => {
          if (stepTimerRef.current !== null) {
            window.clearTimeout(stepTimerRef.current);
            stepTimerRef.current = null;
          }
        },
        getCurrentNodes: () => nodesRef.current,
        applyDraftNodes: (draftNodes, sessionKey) => {
          applyDraftNodes(draftNodes, sessionKey);
          nodesRef.current = draftNodes.map((draft) => draftToNode(draft));
        },
      });
      enqueue = runtime.enqueuePlannerOperations;
      return null;
    }

    render(<Probe />);
    act(() => {
      enqueue?.('session-ordered', [
        {
          type: 'upsert_node',
          node: {
            id: 'node-b',
            title: 'B',
            description: '',
            depends_on: ['node-a'],
            sensitive: false,
          },
        },
        {
          type: 'upsert_node',
          node: {
            id: 'node-c',
            title: 'C',
            description: '',
            depends_on: ['node-b'],
            sensitive: false,
          },
        },
      ]);
    });

    act(() => {
      vi.advanceTimersByTime(80);
    });
    expect(applyDraftNodes).toHaveBeenCalledTimes(1);
    expect((applyDraftNodes.mock.calls[0] as [FlowPlannerNodeDraft[], string])[0].map((item) => item.id)).toEqual([
      'node-a',
      'node-b',
    ]);

    act(() => {
      vi.advanceTimersByTime(80);
    });
    expect(applyDraftNodes).toHaveBeenCalledTimes(2);
    expect((applyDraftNodes.mock.calls[1] as [FlowPlannerNodeDraft[], string])[0].map((item) => item.id)).toEqual([
      'node-a',
      'node-b',
      'node-c',
    ]);
  });

  it('keeps session boundary when another session enqueues during active flush', () => {
    const applyDraftNodes = vi.fn();
    let enqueue: ((sessionKey: string, operations: any[]) => void) | null = null;

    const nodesRef: { current: FlowCanvasNode[] } = {
      current: [makeNode({ id: 'node-a', title: 'A' })],
    };

    function Probe(): null {
      const stepTimerRef = useRef<number | null>(null);
      const runtime = usePlannerOperationQueue({
        stepIntervalMs: 80,
        stepTimerRef,
        clearStepTimer: () => {
          if (stepTimerRef.current !== null) {
            window.clearTimeout(stepTimerRef.current);
            stepTimerRef.current = null;
          }
        },
        getCurrentNodes: () => nodesRef.current,
        applyDraftNodes: (draftNodes, sessionKey) => {
          applyDraftNodes(draftNodes, sessionKey);
          nodesRef.current = draftNodes.map((draft) => draftToNode(draft));
        },
      });
      enqueue = runtime.enqueuePlannerOperations;
      return null;
    }

    render(<Probe />);

    act(() => {
      enqueue?.('session-a', [{
        type: 'upsert_node',
        node: {
          id: 'node-a-1',
          title: 'A1',
          description: '',
          depends_on: ['node-a'],
          sensitive: false,
        },
      }]);
      enqueue?.('session-b', [{
        type: 'upsert_node',
        node: {
          id: 'node-b-1',
          title: 'B1',
          description: '',
          depends_on: ['node-a'],
          sensitive: false,
        },
      }]);
    });

    act(() => {
      vi.advanceTimersByTime(80);
    });
    expect(applyDraftNodes).toHaveBeenCalledTimes(1);
    expect((applyDraftNodes.mock.calls[0] as [FlowPlannerNodeDraft[], string])[1]).toBe('session-a');

    act(() => {
      vi.advanceTimersByTime(80);
    });
    expect(applyDraftNodes).toHaveBeenCalledTimes(2);
    expect((applyDraftNodes.mock.calls[1] as [FlowPlannerNodeDraft[], string])[1]).toBe('session-b');
  });
});
