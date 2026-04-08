import { useEffect, useRef } from 'react';
import type { FlowCanvasEdge, FlowCanvasNode } from '../api/types';
import type { FlowRuntimeState } from '../components/flowPageUtils';

const BLOCKED_SYNC_DEBOUNCE_MS = 280;

type BlockedFlowAutoSyncParams = {
  activeSubmittedRequirementId: string;
  flowDisplayName: string;
  flowNodes: FlowCanvasNode[];
  flowEdges: FlowCanvasEdge[];
  flowRuntimeState: FlowRuntimeState;
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

function buildSyncSignature(requirementId: string, flowDisplayName: string, flowNodes: FlowCanvasNode[], flowEdges: FlowCanvasEdge[]): string {
  const sortedNodes = [...flowNodes]
    .map((node) => ({
      id: node.id,
      title: node.title,
      description: node.description ?? '',
      depends_on: [...node.depends_on].sort((left, right) => left.localeCompare(right, 'en')),
      sensitive: node.sensitive,
      agent_id: node.agent_id ?? '',
    }))
    .sort((left, right) => left.id.localeCompare(right.id, 'en'));
  const sortedEdges = [...flowEdges]
    .map((edge) => ({ source: edge.source, target: edge.target }))
    .sort((left, right) => `${left.source}->${left.target}`.localeCompare(`${right.source}->${right.target}`, 'en'));
  return JSON.stringify({
    requirementId,
    requirementTitle: flowDisplayName.trim(),
    nodes: sortedNodes,
    edges: sortedEdges,
  });
}

export function useBlockedFlowAutoSync({
  activeSubmittedRequirementId,
  flowDisplayName,
  flowNodes,
  flowEdges,
  flowRuntimeState,
  isPlanning,
  isFlowActioning,
  isSubmittingFlow,
  boardId,
  syncRequirement,
  refreshFlowTasks,
  addToast,
}: BlockedFlowAutoSyncParams): void {
  const blockedSyncSignatureRef = useRef('');
  const blockedSyncInFlightSignatureRef = useRef('');
  const blockedSyncTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (blockedSyncTimerRef.current !== null) {
      window.clearTimeout(blockedSyncTimerRef.current);
      blockedSyncTimerRef.current = null;
    }
    if (flowRuntimeState === 'running' || isPlanning || isFlowActioning || isSubmittingFlow) {
      blockedSyncSignatureRef.current = '';
      return;
    }

    const requirementId = activeSubmittedRequirementId.trim();
    if (!requirementId) {
      return;
    }

    const signature = buildSyncSignature(requirementId, flowDisplayName, flowNodes, flowEdges);
    if (signature === blockedSyncSignatureRef.current || signature === blockedSyncInFlightSignatureRef.current) {
      return;
    }

    blockedSyncTimerRef.current = window.setTimeout(() => {
      blockedSyncTimerRef.current = null;
      blockedSyncInFlightSignatureRef.current = signature;
      void syncRequirement(
        requirementId,
        {
          requirement_title: flowDisplayName.trim(),
          nodes: flowNodes,
          edges: flowEdges,
        },
        boardId
      )
        .then(async () => {
          blockedSyncSignatureRef.current = signature;
          await refreshFlowTasks();
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : '流程同步失败';
          addToast(message, 'error');
        })
        .finally(() => {
          if (blockedSyncInFlightSignatureRef.current === signature) {
            blockedSyncInFlightSignatureRef.current = '';
          }
        });
    }, BLOCKED_SYNC_DEBOUNCE_MS);

    return () => {
      if (blockedSyncTimerRef.current !== null) {
        window.clearTimeout(blockedSyncTimerRef.current);
        blockedSyncTimerRef.current = null;
      }
    };
  }, [
    activeSubmittedRequirementId,
    addToast,
    boardId,
    flowDisplayName,
    flowEdges,
    flowNodes,
    flowRuntimeState,
    isFlowActioning,
    isPlanning,
    isSubmittingFlow,
    refreshFlowTasks,
    syncRequirement,
  ]);
}
