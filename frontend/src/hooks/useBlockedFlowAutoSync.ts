import { useCallback, useEffect, useRef } from 'react';
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

type PendingSyncRequest = {
  signature: string;
  requirementId: string;
  requirementTitle: string;
  nodes: FlowCanvasNode[];
  edges: FlowCanvasEdge[];
  boardId: string;
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
  const blockedSyncQueuedRequestRef = useRef<PendingSyncRequest | null>(null);
  const blockedSyncTimerRef = useRef<number | null>(null);

  const launchSyncRequest = useCallback((request: PendingSyncRequest) => {
    if (blockedSyncInFlightSignatureRef.current !== '') {
      blockedSyncQueuedRequestRef.current = request;
      return;
    }
    blockedSyncInFlightSignatureRef.current = request.signature;
    void syncRequirement(
      request.requirementId,
      {
        requirement_title: request.requirementTitle,
        nodes: request.nodes,
        edges: request.edges,
      },
      request.boardId
    )
      .then(async () => {
        blockedSyncSignatureRef.current = request.signature;
        await refreshFlowTasks();
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : '流程同步失败';
        addToast(message, 'error');
      })
      .finally(() => {
        if (blockedSyncInFlightSignatureRef.current === request.signature) {
          blockedSyncInFlightSignatureRef.current = '';
        }
        const queuedRequest = blockedSyncQueuedRequestRef.current;
        if (!queuedRequest) {
          return;
        }
        blockedSyncQueuedRequestRef.current = null;
        if (
          queuedRequest.signature === blockedSyncSignatureRef.current
          || queuedRequest.signature === blockedSyncInFlightSignatureRef.current
        ) {
          return;
        }
        launchSyncRequest(queuedRequest);
      });
  }, [addToast, refreshFlowTasks, syncRequirement]);

  useEffect(() => {
    if (blockedSyncTimerRef.current !== null) {
      window.clearTimeout(blockedSyncTimerRef.current);
      blockedSyncTimerRef.current = null;
    }
    if (flowRuntimeState === 'running' || isPlanning || isFlowActioning || isSubmittingFlow) {
      blockedSyncQueuedRequestRef.current = null;
      return;
    }

    const requirementId = activeSubmittedRequirementId.trim();
    if (!requirementId) {
      return;
    }

    const signature = buildSyncSignature(requirementId, flowDisplayName, flowNodes, flowEdges);
    if (
      signature === blockedSyncSignatureRef.current
      || signature === blockedSyncInFlightSignatureRef.current
      || signature === blockedSyncQueuedRequestRef.current?.signature
    ) {
      return;
    }

    blockedSyncTimerRef.current = window.setTimeout(() => {
      blockedSyncTimerRef.current = null;
      launchSyncRequest({
        signature,
        requirementId,
        requirementTitle: flowDisplayName.trim(),
        nodes: flowNodes,
        edges: flowEdges,
        boardId,
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
    launchSyncRequest,
    refreshFlowTasks,
    syncRequirement,
  ]);

  useEffect(() => {
    return () => {
      if (blockedSyncTimerRef.current !== null) {
        window.clearTimeout(blockedSyncTimerRef.current);
        blockedSyncTimerRef.current = null;
      }
      blockedSyncQueuedRequestRef.current = null;
      blockedSyncInFlightSignatureRef.current = '';
    };
  }, []);
}
