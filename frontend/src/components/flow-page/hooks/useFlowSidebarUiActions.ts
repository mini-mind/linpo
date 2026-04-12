import { useCallback } from 'react';
import type React from 'react';

export type FlowEditorRouteState = {
  draft_flow_id?: string;
  draft_flow_name?: string;
  draft_requirement?: string;
  draft_executor_agent_id?: string;
  prefer_submitted_snapshot?: boolean;
};

export type UseFlowSidebarUiActionsParams = {
  navigate: (to: string, options?: { state?: unknown }) => void;
  setIsMobileFlowSidebarOpen: (next: boolean) => void;
  createFlowNameInput: string;
  createFlowNamePlaceholder: string;
  setCreateFlowNameInput: (next: string) => void;
  setCreateFlowNamePlaceholder: (next: string) => void;
  setIsCreateFlowModalOpen: (next: boolean) => void;
  buildUntitledFlowName: () => string;
  createBlankFlow: (flowName: string) => void;
  draggingSidebarItemId: string | null;
  setDraggingSidebarItemId: (next: string | null) => void;
  moveSidebarCard: (sourceId: string, targetId: string) => void;
};

export type UseFlowSidebarUiActionsResult = {
  navigateToFlowEditor: (flowId: string, routeStatePatch?: Partial<FlowEditorRouteState>) => void;
  handleCreateBlankFlow: () => void;
  handleConfirmCreateFlow: () => void;
  handleSidebarCardDragStart: (flowId: string) => (event: React.DragEvent<HTMLElement>) => void;
  handleSidebarCardDragOver: (event: React.DragEvent<HTMLElement>) => void;
  handleSidebarCardDrop: (targetFlowId: string) => (event: React.DragEvent<HTMLElement>) => void;
  handleSidebarCardDragEnd: () => void;
};

export function useFlowSidebarUiActions(params: UseFlowSidebarUiActionsParams): UseFlowSidebarUiActionsResult {
  const {
    navigate,
    setIsMobileFlowSidebarOpen,
    createFlowNameInput,
    createFlowNamePlaceholder,
    setCreateFlowNameInput,
    setCreateFlowNamePlaceholder,
    setIsCreateFlowModalOpen,
    buildUntitledFlowName,
    createBlankFlow,
    draggingSidebarItemId,
    setDraggingSidebarItemId,
    moveSidebarCard,
  } = params;

  const navigateToFlowEditor = useCallback((flowId: string, routeStatePatch?: Partial<FlowEditorRouteState>) => {
    setIsMobileFlowSidebarOpen(false);
    navigate(`/flow/edit/${encodeURIComponent(flowId)}`, {
      state: routeStatePatch ? { ...routeStatePatch } : undefined,
    });
  }, [navigate, setIsMobileFlowSidebarOpen]);

  const handleCreateBlankFlow = useCallback(() => {
    setCreateFlowNameInput('');
    setCreateFlowNamePlaceholder(buildUntitledFlowName());
    setIsCreateFlowModalOpen(true);
    setIsMobileFlowSidebarOpen(false);
  }, [buildUntitledFlowName, setCreateFlowNameInput, setCreateFlowNamePlaceholder, setIsCreateFlowModalOpen, setIsMobileFlowSidebarOpen]);

  const handleConfirmCreateFlow = useCallback(() => {
    const nextName = createFlowNameInput.trim() || createFlowNamePlaceholder.trim() || buildUntitledFlowName();
    createBlankFlow(nextName);
    setIsCreateFlowModalOpen(false);
  }, [buildUntitledFlowName, createBlankFlow, createFlowNameInput, createFlowNamePlaceholder, setIsCreateFlowModalOpen]);

  const handleSidebarCardDragStart = useCallback((flowId: string) => (event: React.DragEvent<HTMLElement>) => {
    setDraggingSidebarItemId(flowId);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', flowId);
    }
  }, [setDraggingSidebarItemId]);

  const handleSidebarCardDragOver = useCallback((event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }, []);

  const handleSidebarCardDrop = useCallback((targetFlowId: string) => (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    const sourceFlowId = draggingSidebarItemId ?? String(event.dataTransfer?.getData('text/plain') ?? '').trim();
    if (!sourceFlowId || sourceFlowId === targetFlowId) {
      setDraggingSidebarItemId(null);
      return;
    }
    moveSidebarCard(sourceFlowId, targetFlowId);
    setDraggingSidebarItemId(null);
  }, [draggingSidebarItemId, moveSidebarCard, setDraggingSidebarItemId]);

  const handleSidebarCardDragEnd = useCallback(() => {
    setDraggingSidebarItemId(null);
  }, [setDraggingSidebarItemId]);

  return {
    navigateToFlowEditor,
    handleCreateBlankFlow,
    handleConfirmCreateFlow,
    handleSidebarCardDragStart,
    handleSidebarCardDragOver,
    handleSidebarCardDrop,
    handleSidebarCardDragEnd,
  };
}
