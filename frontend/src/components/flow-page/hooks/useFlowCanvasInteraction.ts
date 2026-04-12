import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  AggregateOverviewAgentItem,
  FlowCanvasEdge,
  FlowCanvasNode,
} from '../../../api/types';
import type { ToastMessage } from '../../../hooks/useToast';
import {
  HEADER_HEIGHT,
  LANE_GAP,
  LANE_MIN_WIDTH,
  LANE_SIDE_PADDING,
  NODE_DEFAULT_MARGIN,
  NODE_HEIGHT,
  NODE_VERTICAL_GAP,
  NODE_WIDTH,
  buildConnectorCurvePath,
  buildEdgeRenderMetas,
  findLaneIdByPointX,
  findLaneLayoutForCenterX,
  getNodeConnectorPoint,
  resolveConnectorHandleAtClientPoint,
  resolveNodeLaneId,
  toCanvasPoint,
} from '../../flowPageUtils';
import type {
  ConnectorSide,
  EdgeRenderMeta,
  FlowLane,
  LaneLayout,
  NodeRenderLayout,
} from '../../flowPageUtils';

export type NodeModalState = {
  open: boolean;
  mode: 'create' | 'edit';
  nodeId: string | null;
  laneId: string;
  x: number;
  y: number;
  title: string;
  description: string;
  sensitive: boolean;
};

export type LaneModalState = {
  open: boolean;
  mode: 'create' | 'edit';
  laneId: string | null;
  name: string;
  instanceId: string;
  agentId: string;
};

export type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  nodeIds: string[];
  originByNodeId: Record<string, { globalX: number; y: number; laneId: string }>;
  laneLayouts: Array<{ laneId: string; left: number; width: number; instanceId: string | null; agentId: string | null }>;
};

export type ConnectorHandle = {
  nodeId: string;
  side: ConnectorSide;
};

export type ConnectionDragState = {
  pointerId: number;
  from: ConnectorHandle;
  currentX: number;
  currentY: number;
};

const NODE_DRAG_MOVE_THRESHOLD_PX = 6;
const NODE_DRAG_MOVE_THRESHOLD_SQUARED = NODE_DRAG_MOVE_THRESHOLD_PX * NODE_DRAG_MOVE_THRESHOLD_PX;

export type UseFlowCanvasInteractionParams = {
  canEdit: boolean;
  normalizedLanes: FlowLane[];
  flowNodes: FlowCanvasNode[];
  flowEdges: FlowCanvasEdge[];
  nodeLaneById: Record<string, string>;
  selectedNodeIds: string[];
  selectedEdgeId: string | null;
  connectionDrag?: ConnectionDragState | null;
  nodeModal: NodeModalState;
  laneModal: LaneModalState;
  selectedExecutorAgentId: string;
  uniqueAgents: AggregateOverviewAgentItem[];
  canvasViewportRef: React.RefObject<HTMLDivElement | null>;
  addToast: (message: string, type?: ToastMessage['type']) => void;
  setFlowNodes: React.Dispatch<React.SetStateAction<FlowCanvasNode[]>>;
  setNodeLaneById: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setSelectedNodeIds: React.Dispatch<React.SetStateAction<string[]>>;
  setSelectedEdgeId: React.Dispatch<React.SetStateAction<string | null>>;
  setConnectionDrag?: React.Dispatch<React.SetStateAction<ConnectionDragState | null>>;
  setNodeModal: React.Dispatch<React.SetStateAction<NodeModalState>>;
  setLaneModal: React.Dispatch<React.SetStateAction<LaneModalState>>;
  setLanes: React.Dispatch<React.SetStateAction<FlowLane[]>>;
  setIsDraftCanvas: React.Dispatch<React.SetStateAction<boolean>>;
  setIsSubmittedFlow: React.Dispatch<React.SetStateAction<boolean>>;
};

export type UseFlowCanvasInteractionResult = {
  laneById: Map<string, FlowLane>;
  nodeById: Map<string, FlowCanvasNode>;
  selectedNodeIdSet: Set<string>;
  selectedSingleNodeId: string | null;
  nodesByLane: Map<string, FlowCanvasNode[]>;
  laneLayouts: LaneLayout[];
  laneLayoutById: Map<string, LaneLayout>;
  bodyHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  nodeRenderLayoutById: Map<string, NodeRenderLayout>;
  edgeRenderMetas: EdgeRenderMeta[];
  edgeConnectorUsageByNode: Map<string, Set<ConnectorSide>>;
  isConnecting: boolean;
  connectionPreviewPath: string | null;
  connectionDrag: ConnectionDragState | null;
  openNodeCreateModal: (point: { x: number; y: number }) => void;
  openNodeCreateFromViewport: () => void;
  openNodeEditModal: (nodeId: string) => void;
  openSelectedNodeForEdit: () => void;
  openLaneCreateModal: () => void;
  openLaneEditModal: (laneId: string) => void;
  handleCanvasDoubleClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleCanvasPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  handleSaveNodeModal: () => void;
  handleSaveLaneModal: () => void;
  handleDeleteNodes: (nodeIds: string[]) => void;
  handleRemoveEdge: (edgeId: string) => void;
  handleConnectorPointerDown: (event: React.PointerEvent<HTMLButtonElement>, handle: ConnectorHandle) => void;
  handleConnectorPointerUp: (event: React.PointerEvent<HTMLButtonElement>, handle: ConnectorHandle) => void;
  handleNodePointerDown: (event: React.PointerEvent<HTMLElement>, nodeId: string) => void;
  handleSelectEdge: (edgeId: string) => void;
  handleSelectNode: (nodeId: string, appendSelection: boolean) => void;
};

export function useFlowCanvasInteraction(params: UseFlowCanvasInteractionParams): UseFlowCanvasInteractionResult {
  const {
    canEdit,
    normalizedLanes,
    flowNodes,
    flowEdges,
    nodeLaneById,
    selectedNodeIds,
    selectedEdgeId,
    connectionDrag: controlledConnectionDrag,
    nodeModal,
    laneModal,
    selectedExecutorAgentId,
    uniqueAgents,
    canvasViewportRef,
    addToast,
    setFlowNodes,
    setNodeLaneById,
    setSelectedNodeIds,
    setSelectedEdgeId,
    setConnectionDrag: setConnectionDragExternal,
    setNodeModal,
    setLaneModal,
    setLanes,
    setIsDraftCanvas,
    setIsSubmittedFlow,
  } = params;

  const [dragState, setDragState] = useState<DragState | null>(null);
  const [internalConnectionDrag, setInternalConnectionDrag] = useState<ConnectionDragState | null>(null);
  const connectionDrag = controlledConnectionDrag === undefined ? internalConnectionDrag : controlledConnectionDrag;
  const setConnectionDrag = setConnectionDragExternal ?? setInternalConnectionDrag;

  const laneById = useMemo(() => new Map(normalizedLanes.map((lane) => [lane.id, lane])), [normalizedLanes]);
  const nodeById = useMemo(() => new Map(flowNodes.map((node) => [node.id, node])), [flowNodes]);
  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const selectedSingleNodeId = selectedNodeIds.length === 1 ? selectedNodeIds[0] : null;

  const nodesByLane = useMemo(() => {
    const grouped = new Map<string, FlowCanvasNode[]>();
    for (const lane of normalizedLanes) {
      grouped.set(lane.id, []);
    }
    for (const node of flowNodes) {
      const laneId = resolveNodeLaneId(node.id, nodeLaneById, normalizedLanes);
      const list = grouped.get(laneId) ?? [];
      list.push(node);
      grouped.set(laneId, list);
    }
    // 这里保持稳定排序，避免同一批节点在渲染与拖拽计算中出现抖动。
    for (const list of grouped.values()) {
      list.sort((left, right) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id, 'en'));
    }
    return grouped;
  }, [flowNodes, nodeLaneById, normalizedLanes]);

  const laneLayouts = useMemo<LaneLayout[]>(() => {
    const layouts: LaneLayout[] = [];
    let cursor = LANE_SIDE_PADDING;
    for (const lane of normalizedLanes) {
      const laneNodes = nodesByLane.get(lane.id) ?? [];
      let laneWidth = LANE_MIN_WIDTH;
      for (const node of laneNodes) {
        laneWidth = Math.max(laneWidth, node.x + NODE_WIDTH + NODE_DEFAULT_MARGIN);
      }
      layouts.push({
        lane,
        left: cursor,
        width: laneWidth,
      });
      cursor += laneWidth + LANE_GAP;
    }
    if (layouts.length === 0) {
      layouts.push({
        lane: {
          id: 'lane_unassigned',
          name: '未委派泳道',
          instanceId: null,
          agentId: null,
          createdAt: new Date().toISOString(),
        },
        left: cursor,
        width: LANE_MIN_WIDTH,
      });
    }
    return layouts;
  }, [nodesByLane, normalizedLanes]);

  const laneLayoutById = useMemo(() => new Map(laneLayouts.map((layout) => [layout.lane.id, layout])), [laneLayouts]);

  const bodyHeight = useMemo(() => {
    let height = Math.max(300, NODE_HEIGHT + NODE_DEFAULT_MARGIN * 2);
    for (const node of flowNodes) {
      height = Math.max(height, node.y + NODE_HEIGHT + NODE_DEFAULT_MARGIN);
    }
    return height;
  }, [flowNodes]);

  const canvasWidth = useMemo(() => {
    const last = laneLayouts[laneLayouts.length - 1];
    if (!last) {
      return 0;
    }
    return Math.max(0, last.left + last.width + LANE_SIDE_PADDING);
  }, [laneLayouts]);

  const canvasHeight = HEADER_HEIGHT + bodyHeight;

  const nodeRenderLayoutById = useMemo(() => {
    const map = new Map<string, NodeRenderLayout>();
    for (const node of flowNodes) {
      const laneId = resolveNodeLaneId(node.id, nodeLaneById, normalizedLanes);
      const laneLayout = laneLayoutById.get(laneId);
      if (!laneLayout) {
        continue;
      }
      map.set(node.id, {
        left: laneLayout.left + node.x,
        top: HEADER_HEIGHT + node.y,
        laneId,
      });
    }
    return map;
  }, [flowNodes, laneLayoutById, nodeLaneById, normalizedLanes]);

  const edgeRenderMetas = useMemo(() => buildEdgeRenderMetas(flowEdges, nodeRenderLayoutById), [flowEdges, nodeRenderLayoutById]);
  const edgeConnectorUsageByNode = useMemo(() => {
    const usage = new Map<string, Set<ConnectorSide>>();
    for (const edge of edgeRenderMetas) {
      if (!usage.has(edge.source)) {
        usage.set(edge.source, new Set<ConnectorSide>());
      }
      if (!usage.has(edge.target)) {
        usage.set(edge.target, new Set<ConnectorSide>());
      }
      usage.get(edge.source)?.add(edge.sourceSide);
      usage.get(edge.target)?.add(edge.targetSide);
    }
    return usage;
  }, [edgeRenderMetas]);

  const isConnecting = connectionDrag !== null;
  const connectionPreviewPath = useMemo(() => {
    if (!connectionDrag) {
      return null;
    }
    const sourceLayout = nodeRenderLayoutById.get(connectionDrag.from.nodeId);
    if (!sourceLayout) {
      return null;
    }
    const sourcePoint = getNodeConnectorPoint(sourceLayout, connectionDrag.from.side);
    return buildConnectorCurvePath(sourcePoint, {
      x: connectionDrag.currentX,
      y: connectionDrag.currentY,
    });
  }, [connectionDrag, nodeRenderLayoutById]);

  const openNodeCreateModal = useCallback((point: { x: number; y: number }) => {
    const laneId = findLaneIdByPointX(point.x, laneLayouts) ?? normalizedLanes[0]?.id ?? '';
    if (!laneId) {
      addToast('请先创建泳道', 'warning');
      return;
    }
    const laneLayout = laneLayoutById.get(laneId);
    if (!laneLayout) {
      addToast('泳道不可用，请重试', 'warning');
      return;
    }
    const localX = Math.max(NODE_DEFAULT_MARGIN, point.x - laneLayout.left - NODE_WIDTH / 2);
    const localY = Math.max(NODE_DEFAULT_MARGIN, point.y - HEADER_HEIGHT - NODE_HEIGHT / 2);
    setNodeModal({
      open: true,
      mode: 'create',
      nodeId: null,
      laneId,
      x: localX,
      y: localY,
      title: '新任务节点',
      description: '',
      sensitive: false,
    });
  }, [addToast, laneLayoutById, laneLayouts, normalizedLanes, setNodeModal]);

  const openNodeCreateFromViewport = useCallback(() => {
    const selectedLayout = selectedSingleNodeId ? nodeRenderLayoutById.get(selectedSingleNodeId) : null;
    if (selectedLayout) {
      openNodeCreateModal({
        x: selectedLayout.left + NODE_WIDTH / 2,
        y: selectedLayout.top + NODE_HEIGHT + NODE_VERTICAL_GAP / 2,
      });
      return;
    }
    const viewport = canvasViewportRef.current;
    if (!viewport) {
      addToast('画布尚未就绪，请稍后重试', 'warning');
      return;
    }
    const rect = viewport.getBoundingClientRect();
    openNodeCreateModal({
      x: viewport.scrollLeft + Math.max(rect.width / 2, LANE_SIDE_PADDING + NODE_WIDTH / 2),
      y: viewport.scrollTop + Math.max(rect.height / 2, HEADER_HEIGHT + NODE_DEFAULT_MARGIN + NODE_HEIGHT / 2),
    });
  }, [addToast, canvasViewportRef, nodeRenderLayoutById, openNodeCreateModal, selectedSingleNodeId]);

  const openNodeEditModal = useCallback((nodeId: string) => {
    const node = nodeById.get(nodeId);
    if (!node) {
      return;
    }
    const laneId = resolveNodeLaneId(node.id, nodeLaneById, normalizedLanes);
    setNodeModal({
      open: true,
      mode: 'edit',
      nodeId: node.id,
      laneId,
      x: node.x,
      y: node.y,
      title: node.title,
      description: (node.description ?? '').trim(),
      sensitive: node.sensitive,
    });
  }, [nodeById, nodeLaneById, normalizedLanes, setNodeModal]);

  const openSelectedNodeForEdit = useCallback(() => {
    if (!selectedSingleNodeId) {
      addToast('请先选中一个节点', 'warning');
      return;
    }
    openNodeEditModal(selectedSingleNodeId);
  }, [addToast, openNodeEditModal, selectedSingleNodeId]);

  const openLaneCreateModal = useCallback(() => {
    const preferredAgent = uniqueAgents.find((agent) => agent.agent_id === selectedExecutorAgentId.trim()) ?? uniqueAgents[0];
    setLaneModal({
      open: true,
      mode: 'create',
      laneId: null,
      name: '',
      instanceId: preferredAgent?.instance_id ?? '',
      agentId: preferredAgent?.agent_id ?? '',
    });
  }, [selectedExecutorAgentId, setLaneModal, uniqueAgents]);

  const openLaneEditModal = useCallback((laneId: string) => {
    const lane = laneById.get(laneId);
    if (!lane) {
      return;
    }
    setLaneModal({
      open: true,
      mode: 'edit',
      laneId: lane.id,
      name: lane.name,
      instanceId: lane.instanceId ?? '',
      agentId: lane.agentId ?? '',
    });
  }, [laneById, setLaneModal]);

  const handleCanvasDoubleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!canEdit) {
      return;
    }
    const point = toCanvasPoint(canvasViewportRef.current, event.clientX, event.clientY);
    if (!point) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest('[data-flow-node-card="true"]') || target.closest('[data-flow-lane-title="true"]')) {
      return;
    }

    if (point.y <= HEADER_HEIGHT) {
      openLaneCreateModal();
      return;
    }
    openNodeCreateModal(point);
  }, [canEdit, canvasViewportRef, openLaneCreateModal, openNodeCreateModal]);

  const handleCanvasPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (
      target.closest('[data-flow-node-card="true"]') ||
      target.closest('[data-flow-edge-path="true"]') ||
      target.closest('button') ||
      target.closest('input') ||
      target.closest('select') ||
      target.closest('textarea')
    ) {
      return;
    }
    setSelectedNodeIds([]);
    setSelectedEdgeId(null);
    setConnectionDrag(null);
  }, [setSelectedEdgeId, setSelectedNodeIds]);

  const handleSaveNodeModal = useCallback(() => {
    const laneId = nodeModal.laneId.trim();
    if (!laneId || !laneById.has(laneId)) {
      addToast('请选择有效泳道', 'warning');
      return;
    }
    const title = nodeModal.title.trim();
    if (!title) {
      addToast('节点标题不能为空', 'warning');
      return;
    }
    const description = nodeModal.description.trim();

    if (nodeModal.mode === 'create') {
      const nodeId = `node_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const lane = laneById.get(laneId);
      setFlowNodes((current) => [
        ...current,
        {
          id: nodeId,
          title,
          description,
          depends_on: [],
          x: nodeModal.x,
          y: nodeModal.y,
          layer: 1,
          sensitive: nodeModal.sensitive,
          status: 'queued',
          instance_id: lane?.instanceId ?? null,
          agent_id: lane?.agentId ?? (selectedExecutorAgentId.trim() || null),
        },
      ]);
      setNodeLaneById((current) => ({ ...current, [nodeId]: laneId }));
      setSelectedNodeIds([nodeId]);
      setSelectedEdgeId(null);
      setNodeModal((current) => ({ ...current, open: false }));
      setIsDraftCanvas(true);
      setIsSubmittedFlow(false);
      return;
    }

    if (!nodeModal.nodeId) {
      return;
    }
    setFlowNodes((current) =>
      current.map((node) =>
        node.id === nodeModal.nodeId
          ? {
              ...node,
              title,
              description,
              sensitive: nodeModal.sensitive,
            }
          : node
      )
    );
    setSelectedEdgeId(null);
    setNodeModal((current) => ({ ...current, open: false }));
    setIsDraftCanvas(true);
    setIsSubmittedFlow(false);
  }, [addToast, laneById, nodeModal, selectedExecutorAgentId, setFlowNodes, setIsDraftCanvas, setIsSubmittedFlow, setNodeLaneById, setNodeModal, setSelectedEdgeId, setSelectedNodeIds]);

  const handleSaveLaneModal = useCallback(() => {
    const laneName = laneModal.name.trim() || '未命名泳道';
    const agentId = laneModal.agentId.trim() || null;
    const instanceId = agentId ? (laneModal.instanceId.trim() || null) : null;
    if (laneModal.mode === 'create') {
      const laneId = `lane_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      setLanes((current) => [
        ...current,
        {
          id: laneId,
          name: laneName,
          instanceId,
          agentId,
          createdAt: new Date().toISOString(),
        },
      ]);
      setLaneModal((current) => ({ ...current, open: false }));
      setIsDraftCanvas(true);
      setIsSubmittedFlow(false);
      return;
    }

    if (!laneModal.laneId) {
      return;
    }
    setLanes((current) =>
      current.map((lane) =>
        lane.id === laneModal.laneId
          ? {
              ...lane,
              name: laneName,
              instanceId,
              agentId,
            }
          : lane
      )
    );
    setFlowNodes((current) =>
      current.map((node) => {
        const laneId = resolveNodeLaneId(node.id, nodeLaneById, normalizedLanes);
        if (laneId !== laneModal.laneId) {
          return node;
        }
        return {
          ...node,
          instance_id: instanceId ?? node.instance_id,
          agent_id: agentId ?? node.agent_id,
        };
      })
    );
    setLaneModal((current) => ({ ...current, open: false }));
    setIsDraftCanvas(true);
    setIsSubmittedFlow(false);
  }, [laneModal, nodeLaneById, normalizedLanes, setFlowNodes, setIsDraftCanvas, setIsSubmittedFlow, setLaneModal, setLanes]);

  const handleDeleteNodes = useCallback((nodeIds: string[]) => {
    if (!canEdit) {
      addToast('正在规划中，请稍后编辑', 'warning');
      return;
    }
    const deleting = new Set(nodeIds);
    if (deleting.size === 0) {
      return;
    }
    // 节点与 lane 映射必须同时收敛，否则会留下“已删除节点仍有 lane 归属”的脏状态。
    setFlowNodes((current) =>
      current
        .filter((node) => !deleting.has(node.id))
        .map((node) => ({
          ...node,
          depends_on: node.depends_on.filter((dependency) => !deleting.has(dependency)),
        }))
    );
    setNodeLaneById((current) => {
      const next: Record<string, string> = {};
      for (const [nodeId, laneId] of Object.entries(current)) {
        if (!deleting.has(nodeId)) {
          next[nodeId] = laneId;
        }
      }
      return next;
    });
    setSelectedNodeIds([]);
    setSelectedEdgeId(null);
    setConnectionDrag(null);
    setIsDraftCanvas(true);
    setIsSubmittedFlow(false);
  }, [addToast, canEdit, setFlowNodes, setIsDraftCanvas, setIsSubmittedFlow, setNodeLaneById, setSelectedEdgeId, setSelectedNodeIds]);

  const handleRemoveEdge = useCallback((edgeId: string) => {
    if (!canEdit) {
      addToast('正在规划中，请稍后编辑', 'warning');
      return;
    }
    const edge = flowEdges.find((item) => item.id === edgeId);
    if (!edge) {
      setSelectedEdgeId((current) => (current === edgeId ? null : current));
      return;
    }
    setFlowNodes((current) =>
      current.map((node) =>
        node.id === edge.target
          ? {
              ...node,
              depends_on: node.depends_on.filter((dependency) => dependency !== edge.source),
            }
          : node
      )
    );
    setSelectedEdgeId((current) => (current === edgeId ? null : current));
    setIsDraftCanvas(true);
    setIsSubmittedFlow(false);
  }, [addToast, canEdit, flowEdges, setFlowNodes, setIsDraftCanvas, setIsSubmittedFlow, setSelectedEdgeId]);

  const commitConnectionToHandle = useCallback((handle: ConnectorHandle) => {
    if (!connectionDrag) {
      return false;
    }
    const sourceNodeId = connectionDrag.from.nodeId;
    if (sourceNodeId === handle.nodeId) {
      setConnectionDrag(null);
      return true;
    }
    const duplicated = flowEdges.some((edge) => edge.source === sourceNodeId && edge.target === handle.nodeId);
    if (duplicated) {
      setConnectionDrag(null);
      addToast('连接已存在', 'warning');
      return true;
    }
    setFlowNodes((current) =>
      current.map((node) =>
        node.id === handle.nodeId
          ? {
              ...node,
              depends_on: [...node.depends_on, sourceNodeId],
            }
          : node
      )
    );
    setSelectedEdgeId(null);
    setIsDraftCanvas(true);
    setIsSubmittedFlow(false);
    setConnectionDrag(null);
    return true;
  }, [addToast, connectionDrag, flowEdges, setFlowNodes, setIsDraftCanvas, setIsSubmittedFlow, setSelectedEdgeId]);

  const handleConnectorPointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>, handle: ConnectorHandle) => {
    event.stopPropagation();
    event.preventDefault();
    if (!canEdit) {
      addToast('正在规划中，请稍后编辑', 'warning');
      return;
    }
    const point = toCanvasPoint(canvasViewportRef.current, event.clientX, event.clientY);
    if (!point) {
      return;
    }
    setConnectionDrag({
      pointerId: event.pointerId,
      from: handle,
      currentX: point.x,
      currentY: point.y,
    });
    setSelectedEdgeId(null);
  }, [addToast, canEdit, canvasViewportRef, setSelectedEdgeId]);

  const handleConnectorPointerUp = useCallback((event: React.PointerEvent<HTMLButtonElement>, handle: ConnectorHandle) => {
    event.stopPropagation();
    event.preventDefault();
    if (!connectionDrag) {
      return;
    }
    if (event.pointerId !== connectionDrag.pointerId) {
      return;
    }
    commitConnectionToHandle(handle);
  }, [commitConnectionToHandle, connectionDrag]);

  const handleNodePointerDown = useCallback((event: React.PointerEvent<HTMLElement>, nodeId: string) => {
    if (!canEdit || (event.pointerType === 'mouse' && event.button !== 0) || event.isPrimary === false) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest('[data-flow-connector="true"]')) {
      return;
    }
    const appendSelection = event.metaKey || event.ctrlKey;
    setSelectedNodeIds((current) => {
      if (appendSelection) {
        if (current.includes(nodeId)) {
          return current;
        }
        return [...current, nodeId];
      }
      return [nodeId];
    });
    setSelectedEdgeId(null);
    const selectedIds = appendSelection && selectedNodeIds.length > 0
      ? Array.from(new Set([...selectedNodeIds, nodeId]))
      : [nodeId];
    const laneLayoutsSnapshot = laneLayouts.map((layout) => ({
      laneId: layout.lane.id,
      left: layout.left,
      width: layout.width,
      instanceId: layout.lane.instanceId,
      agentId: layout.lane.agentId,
    }));
    const originByNodeId: Record<string, { globalX: number; y: number; laneId: string }> = {};
    for (const id of selectedIds) {
      const node = nodeById.get(id);
      if (!node) {
        continue;
      }
      const laneId = resolveNodeLaneId(node.id, nodeLaneById, normalizedLanes);
      const laneLayout = laneLayoutById.get(laneId);
      originByNodeId[id] = {
        globalX: (laneLayout?.left ?? 0) + node.x,
        y: node.y,
        laneId,
      };
    }
    setDragState({
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      nodeIds: selectedIds,
      originByNodeId,
      laneLayouts: laneLayoutsSnapshot,
    });
  }, [canEdit, laneLayoutById, laneLayouts, nodeById, nodeLaneById, normalizedLanes, selectedNodeIds, setSelectedEdgeId, setSelectedNodeIds]);

  useEffect(() => {
    if (!dragState) {
      return;
    }
    let hasExceededMoveThreshold = false;

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) {
        return;
      }
      const deltaX = event.clientX - dragState.startX;
      const deltaY = event.clientY - dragState.startY;
      if (!hasExceededMoveThreshold) {
        const distanceSquared = deltaX ** 2 + deltaY ** 2;
        if (distanceSquared < NODE_DRAG_MOVE_THRESHOLD_SQUARED) {
          return;
        }
        hasExceededMoveThreshold = true;
      }
      const laneUpdates: Record<string, string> = {};
      setFlowNodes((current) =>
        current.map((node) => {
          if (!dragState.nodeIds.includes(node.id)) {
            return node;
          }
          const origin = dragState.originByNodeId[node.id];
          if (!origin) {
            return node;
          }
          const nextGlobalX = origin.globalX + deltaX;
          const nodeCenterX = nextGlobalX + NODE_WIDTH / 2;
          const nextLane = findLaneLayoutForCenterX(nodeCenterX, dragState.laneLayouts) ?? dragState.laneLayouts[0];
          const nextLaneId = nextLane?.laneId ?? origin.laneId;
          const nextLaneLeft = nextLane?.left ?? 0;
          laneUpdates[node.id] = nextLaneId;
          return {
            ...node,
            x: Math.max(NODE_DEFAULT_MARGIN, nextGlobalX - nextLaneLeft),
            y: Math.max(NODE_DEFAULT_MARGIN, origin.y + deltaY),
            instance_id: nextLane ? nextLane.instanceId : node.instance_id,
            agent_id: nextLane ? nextLane.agentId : node.agent_id,
          };
        })
      );
      // 这里与节点坐标同帧更新 lane 映射，避免“视觉已跨泳道但依赖数据仍在旧泳道”。
      if (Object.keys(laneUpdates).length > 0) {
        setNodeLaneById((current) => ({ ...current, ...laneUpdates }));
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) {
        return;
      }
      setDragState(null);
      if (hasExceededMoveThreshold) {
        setIsDraftCanvas(true);
        setIsSubmittedFlow(false);
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [dragState, setFlowNodes, setIsDraftCanvas, setIsSubmittedFlow, setNodeLaneById]);

  useEffect(() => {
    if (!connectionDrag) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== connectionDrag.pointerId) {
        return;
      }
      const point = toCanvasPoint(canvasViewportRef.current, event.clientX, event.clientY);
      if (!point) {
        return;
      }
      setConnectionDrag((current) => (current ? { ...current, currentX: point.x, currentY: point.y } : current));
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId !== connectionDrag.pointerId) {
        return;
      }
      const targetHandle = resolveConnectorHandleAtClientPoint(event.clientX, event.clientY);
      if (targetHandle && commitConnectionToHandle(targetHandle)) {
        return;
      }
      setConnectionDrag(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [canvasViewportRef, commitConnectionToHandle, connectionDrag]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete') {
        return;
      }
      const activeElement = document.activeElement as HTMLElement | null;
      // 输入态不拦截 Delete，保证表单编辑行为与浏览器默认一致。
      if (
        activeElement &&
        (activeElement.tagName === 'INPUT' ||
          activeElement.tagName === 'TEXTAREA' ||
          activeElement.tagName === 'SELECT' ||
          activeElement.isContentEditable)
      ) {
        return;
      }
      if (selectedNodeIds.length > 0) {
        event.preventDefault();
        handleDeleteNodes(selectedNodeIds);
        return;
      }
      if (selectedEdgeId) {
        event.preventDefault();
        handleRemoveEdge(selectedEdgeId);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleDeleteNodes, handleRemoveEdge, selectedEdgeId, selectedNodeIds]);

  useEffect(() => {
    if (!selectedEdgeId) {
      return;
    }
    if (flowEdges.some((edge) => edge.id === selectedEdgeId)) {
      return;
    }
    setSelectedEdgeId(null);
  }, [flowEdges, selectedEdgeId, setSelectedEdgeId]);

  const handleSelectEdge = useCallback((edgeId: string) => {
    setSelectedNodeIds([]);
    setSelectedEdgeId(edgeId);
  }, [setSelectedEdgeId, setSelectedNodeIds]);

  const handleSelectNode = useCallback((nodeId: string, appendSelection: boolean) => {
    setSelectedNodeIds((current) => {
      if (!appendSelection) {
        return [nodeId];
      }
      if (current.includes(nodeId)) {
        return current.filter((item) => item !== nodeId);
      }
      return [...current, nodeId];
    });
    setSelectedEdgeId(null);
  }, [setSelectedEdgeId, setSelectedNodeIds]);

  return {
    laneById,
    nodeById,
    selectedNodeIdSet,
    selectedSingleNodeId,
    nodesByLane,
    laneLayouts,
    laneLayoutById,
    bodyHeight,
    canvasWidth,
    canvasHeight,
    nodeRenderLayoutById,
    edgeRenderMetas,
    edgeConnectorUsageByNode,
    isConnecting,
    connectionPreviewPath,
    connectionDrag,
    openNodeCreateModal,
    openNodeCreateFromViewport,
    openNodeEditModal,
    openSelectedNodeForEdit,
    openLaneCreateModal,
    openLaneEditModal,
    handleCanvasDoubleClick,
    handleCanvasPointerDown,
    handleSaveNodeModal,
    handleSaveLaneModal,
    handleDeleteNodes,
    handleRemoveEdge,
    handleConnectorPointerDown,
    handleConnectorPointerUp,
    handleNodePointerDown,
    handleSelectEdge,
    handleSelectNode,
  };
}
