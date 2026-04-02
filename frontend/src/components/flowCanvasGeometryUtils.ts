import type { FlowCanvasEdge } from '../api/types';
import {
  NODE_BORDER_WIDTH,
  NODE_HEIGHT,
  NODE_WIDTH,
} from './flowPageStateUtils';
import type {
  ConnectorSide,
  EdgeRenderMeta,
  LaneLayout,
  NodeRenderLayout,
} from './flowPageStateUtils';

type ConnectorHandle = {
  nodeId: string;
  side: ConnectorSide;
};

export function findLaneIdByPointX(pointX: number, laneLayouts: LaneLayout[]): string | null {
  for (const layout of laneLayouts) {
    if (pointX >= layout.left && pointX <= layout.left + layout.width) {
      return layout.lane.id;
    }
  }
  return null;
}

export function toCanvasPoint(
  viewport: HTMLDivElement | null,
  clientX: number,
  clientY: number
): { x: number; y: number } | null {
  if (!viewport) {
    return null;
  }
  const rect = viewport.getBoundingClientRect();
  const left = Number.isFinite(rect.left) ? rect.left : 0;
  const top = Number.isFinite(rect.top) ? rect.top : 0;
  const scrollLeft = Number.isFinite(viewport.scrollLeft) ? viewport.scrollLeft : 0;
  const scrollTop = Number.isFinite(viewport.scrollTop) ? viewport.scrollTop : 0;
  const x = clientX - left + scrollLeft;
  const y = clientY - top + scrollTop;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x, y };
}

export function findLaneLayoutForCenterX(
  centerX: number,
  laneLayouts: Array<{ laneId: string; left: number; width: number; agentId: string | null }>
): { laneId: string; left: number; width: number; agentId: string | null } | null {
  if (laneLayouts.length === 0) {
    return null;
  }
  for (const lane of laneLayouts) {
    if (centerX >= lane.left && centerX <= lane.left + lane.width) {
      return lane;
    }
  }
  if (centerX < laneLayouts[0].left) {
    return laneLayouts[0];
  }
  return laneLayouts[laneLayouts.length - 1];
}

export function getConnectorHandleFromElement(element: Element | null): ConnectorHandle | null {
  const connector = element?.closest('[data-flow-connector="true"]');
  if (!(connector instanceof HTMLElement)) {
    return null;
  }
  const nodeId = connector.dataset.nodeId?.trim() ?? '';
  const side = connector.dataset.side as ConnectorSide | undefined;
  if (!nodeId || !side) {
    return null;
  }
  return { nodeId, side };
}

export function resolveConnectorHandleAtClientPoint(clientX: number, clientY: number): ConnectorHandle | null {
  const elements = typeof document.elementsFromPoint === 'function'
    ? document.elementsFromPoint(clientX, clientY)
    : [document.elementFromPoint(clientX, clientY)].filter((element): element is Element => element !== null);
  for (const element of elements) {
    const handle = getConnectorHandleFromElement(element);
    if (handle) {
      return handle;
    }
  }
  return null;
}

export function getNodeConnectorPoint(layout: NodeRenderLayout, side: ConnectorSide): { x: number; y: number } {
  const centerX = layout.left + NODE_WIDTH / 2;
  const centerY = layout.top + NODE_HEIGHT / 2;
  if (side === 'top') {
    return { x: centerX, y: layout.top + NODE_BORDER_WIDTH };
  }
  if (side === 'right') {
    return { x: layout.left + NODE_WIDTH - NODE_BORDER_WIDTH, y: centerY };
  }
  if (side === 'bottom') {
    return { x: centerX, y: layout.top + NODE_HEIGHT - NODE_BORDER_WIDTH };
  }
  return { x: layout.left + NODE_BORDER_WIDTH, y: centerY };
}

export function resolveShortestConnectorPair(
  sourceLayout: NodeRenderLayout,
  targetLayout: NodeRenderLayout
): {
  source: { x: number; y: number };
  target: { x: number; y: number };
  sourceSide: ConnectorSide;
  targetSide: ConnectorSide;
} {
  const sides: ConnectorSide[] = ['top', 'right', 'bottom', 'left'];
  let best: {
    source: { x: number; y: number };
    target: { x: number; y: number };
    sourceSide: ConnectorSide;
    targetSide: ConnectorSide;
    distance: number;
  } | null = null;
  for (const sourceSide of sides) {
    const sourcePoint = getNodeConnectorPoint(sourceLayout, sourceSide);
    for (const targetSide of sides) {
      const targetPoint = getNodeConnectorPoint(targetLayout, targetSide);
      const dx = targetPoint.x - sourcePoint.x;
      const dy = targetPoint.y - sourcePoint.y;
      const distance = dx * dx + dy * dy;
      if (!best || distance < best.distance) {
        best = {
          source: sourcePoint,
          target: targetPoint,
          sourceSide,
          targetSide,
          distance,
        };
      }
    }
  }
  return {
    source: best?.source ?? getNodeConnectorPoint(sourceLayout, 'right'),
    target: best?.target ?? getNodeConnectorPoint(targetLayout, 'left'),
    sourceSide: best?.sourceSide ?? 'right',
    targetSide: best?.targetSide ?? 'left',
  };
}

export function buildConnectorCurvePath(
  source: { x: number; y: number },
  target: { x: number; y: number }
): string {
  const deltaX = target.x - source.x;
  const deltaY = target.y - source.y;
  const offsetX = Math.max(48, Math.abs(deltaX) * 0.45);
  const offsetY = Math.max(28, Math.abs(deltaY) * 0.24);
  const c1x = source.x + (deltaX >= 0 ? offsetX : -offsetX);
  const c1y = source.y + (deltaY >= 0 ? offsetY : -offsetY * 0.2);
  const c2x = target.x - (deltaX >= 0 ? offsetX : -offsetX);
  const c2y = target.y - (deltaY >= 0 ? offsetY * 0.2 : -offsetY);
  return `M ${source.x} ${source.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${target.x} ${target.y}`;
}

export function buildEdgeRenderMetas(
  edges: FlowCanvasEdge[],
  nodeLayoutMap: Map<string, NodeRenderLayout>
): EdgeRenderMeta[] {
  const result: EdgeRenderMeta[] = [];
  for (const edge of edges) {
    const sourcePos = nodeLayoutMap.get(edge.source);
    const targetPos = nodeLayoutMap.get(edge.target);
    if (!sourcePos || !targetPos) {
      continue;
    }
    const pair = resolveShortestConnectorPair(sourcePos, targetPos);
    const path = buildConnectorCurvePath(pair.source, pair.target);
    result.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      path,
      sourceSide: pair.sourceSide,
      targetSide: pair.targetSide,
    });
  }
  return result;
}
