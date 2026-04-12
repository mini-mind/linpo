import type React from 'react';

import type { FlowCanvasNode } from '../../api/types';
import type {
  ConnectorSide,
  EdgeRenderMeta,
  FlowLane,
  LaneLayout,
  NodeRenderLayout,
} from '../flowPageUtils';
import { buildAgentScopeKey } from '../flowAgentScopeUtils';
import {
  canvasFloatingActionsStyle,
  canvasFloatingActionsMobileStyle,
  canvasFloatingActionRowStyle,
  canvasFloatingActionRowMobileStyle,
  secondaryButtonStyle,
  dangerButtonStyle,
  planningCanvasOverlayStyle,
  emptySelectionOverlayStyle,
  emptySelectionOverlayMobileStyle,
  emptySelectionCardStyle,
  emptySelectionEyebrowStyle,
  emptySelectionTitleStyle,
  emptySelectionTextStyle,
  primaryButtonStyle,
  canvasViewportStyle,
  canvasViewportMobileStyle,
  canvasSurfaceStyle,
  stickyHeaderStyle,
  laneHeaderCellStyle,
  laneHeaderNameStyle,
  laneHeaderAgentStyle,
  laneHeaderHintStyle,
  laneBodyStyle,
  laneColumnStyle,
  edgeSvgStyle,
  edgePathSelectedStyle,
  edgePathStyle,
  edgeHitPathStyle,
  edgePreviewPathStyle,
  flowNodeCardStyle,
  nodeHeaderStyle,
  nodeStatusStyle,
  nodeLaneStyle,
  nodeTitleStyle,
  nodeDescriptionStyle,
  nodeMetaStyle,
  connectorStyle,
  connectorTopStyle,
  connectorRightStyle,
  connectorBottomStyle,
  connectorLeftStyle,
  emptyCanvasHintStyle,
  emptyCanvasTextStyle,
} from '../flowPageStyles';

type ConnectionDragState = {
  from: {
    nodeId: string;
    side: ConnectorSide;
  };
};

type FlowCanvasPaneProps = {
  isMobile: boolean;
  hasSelectedFlow: boolean;
  canEdit: boolean;
  selectedNodeIds: string[];
  selectedSingleNodeId: string | null;
  selectedEdgeId: string | null;
  onOpenNodeCreateFromViewport: () => void;
  onOpenSelectedNodeForEdit: () => void;
  onDeleteNodes: (nodeIds: string[]) => void;
  onDeleteEdge: (edgeId: string) => void;
  isPlannerAutoMode: boolean;
  isPlannerAwaiting: boolean;
  isPlannerOverlayDismissible: boolean;
  onCollapsePlannerOverlay: () => void;
  isBlankFlowSelection: boolean;
  onCreateBlankFlow: () => void;
  bindCanvasViewportRef: (node: HTMLDivElement | null) => void;
  isPlannerExpanded: boolean;
  onCanvasDoubleClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onCanvasPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  canvasWidth: number;
  canvasHeight: number;
  laneLayouts: LaneLayout[];
  onOpenLaneEditModal: (laneId: string) => void;
  agentLabelByScope: Map<string, string>;
  bodyHeight: number;
  edgeRenderMetas: EdgeRenderMeta[];
  connectionPreviewPath: string | null;
  onSelectEdge: (edgeId: string) => void;
  flowNodes: FlowCanvasNode[];
  nodeRenderLayoutById: Map<string, NodeRenderLayout>;
  selectedNodeIdSet: Set<string>;
  laneById: Map<string, FlowLane>;
  edgeConnectorUsageByNode: Map<string, Set<ConnectorSide>>;
  isConnecting: boolean;
  isSubmittedFlow: boolean;
  connectionDrag: ConnectionDragState | null;
  onSelectNode: (nodeId: string, appendSelection: boolean) => void;
  onOpenNodeEditModal: (nodeId: string) => void;
  onNodePointerDown: (event: React.PointerEvent<HTMLElement>, nodeId: string) => void;
  onConnectorPointerDown: (event: React.PointerEvent<HTMLButtonElement>, target: { nodeId: string; side: ConnectorSide }) => void;
  onConnectorPointerUp: (event: React.PointerEvent<HTMLButtonElement>, target: { nodeId: string; side: ConnectorSide }) => void;
};

export function FlowCanvasPane(props: FlowCanvasPaneProps): JSX.Element {
  const {
    isMobile,
    hasSelectedFlow,
    canEdit,
    selectedNodeIds,
    selectedSingleNodeId,
    selectedEdgeId,
    onOpenNodeCreateFromViewport,
    onOpenSelectedNodeForEdit,
    onDeleteNodes,
    onDeleteEdge,
    isPlannerAutoMode,
    isPlannerAwaiting,
    isPlannerOverlayDismissible,
    onCollapsePlannerOverlay,
    isBlankFlowSelection,
    onCreateBlankFlow,
    bindCanvasViewportRef,
    isPlannerExpanded,
    onCanvasDoubleClick,
    onCanvasPointerDown,
    canvasWidth,
    canvasHeight,
    laneLayouts,
    onOpenLaneEditModal,
    agentLabelByScope,
    bodyHeight,
    edgeRenderMetas,
    connectionPreviewPath,
    onSelectEdge,
    flowNodes,
    nodeRenderLayoutById,
    selectedNodeIdSet,
    laneById,
    edgeConnectorUsageByNode,
    isConnecting,
    isSubmittedFlow,
    connectionDrag,
    onSelectNode,
    onOpenNodeEditModal,
    onNodePointerDown,
    onConnectorPointerDown,
    onConnectorPointerUp,
  } = props;
  const showMobileDeleteNodeAction = isMobile && canEdit && selectedNodeIds.length > 0;
  const showMobileDeleteEdgeAction = isMobile && canEdit && selectedEdgeId !== null;
  const showMobileNodeActions = isMobile && hasSelectedFlow;

  // 画布组件只负责渲染与交互透传，不持有流程业务状态。
  return (
    <>
      {isMobile && hasSelectedFlow ? (
        <div
          style={isMobile ? { ...canvasFloatingActionsStyle, ...canvasFloatingActionsMobileStyle } : canvasFloatingActionsStyle}
          role="group"
          aria-label="流程画布操作"
          data-testid="flow-canvas-floating-actions"
        >
          <div style={isMobile ? { ...canvasFloatingActionRowStyle, ...canvasFloatingActionRowMobileStyle } : canvasFloatingActionRowStyle}>
            {showMobileNodeActions ? (
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={onOpenNodeCreateFromViewport}
                disabled={!canEdit}
                aria-label="新建节点"
              >
                新建节点
              </button>
            ) : null}
            {showMobileNodeActions ? (
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={onOpenSelectedNodeForEdit}
                disabled={!canEdit || !selectedSingleNodeId}
                aria-label="编辑已选节点"
              >
                编辑节点
              </button>
            ) : null}
            {showMobileDeleteNodeAction ? (
              <button
                type="button"
                style={dangerButtonStyle}
                onClick={() => onDeleteNodes(selectedNodeIds)}
                aria-label="删除所选节点"
              >
                删除节点
              </button>
            ) : null}
            {showMobileDeleteEdgeAction ? (
              <button
                type="button"
                style={dangerButtonStyle}
                onClick={() => {
                  if (!selectedEdgeId) {
                    return;
                  }
                  onDeleteEdge(selectedEdgeId);
                }}
                aria-label="删除所选连线"
              >
                删除连线
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {isPlannerAutoMode ? (
        <div
          style={{
            ...planningCanvasOverlayStyle,
            cursor: isPlannerAwaiting || !isPlannerOverlayDismissible ? 'progress' : 'pointer',
          }}
          data-testid="flow-planning-overlay"
          aria-hidden="true"
          onPointerDown={(event) => {
            if (isPlannerAwaiting || !isPlannerOverlayDismissible) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            onCollapsePlannerOverlay();
          }}
        />
      ) : null}

      {isBlankFlowSelection ? (
        <div style={isMobile ? { ...emptySelectionOverlayStyle, ...emptySelectionOverlayMobileStyle } : emptySelectionOverlayStyle} data-testid="flow-empty-selection-overlay">
          <div style={emptySelectionCardStyle}>
            <p style={emptySelectionEyebrowStyle}>欢迎来到流程编辑台</p>
            <h2 style={emptySelectionTitleStyle}>从左侧选择一个流程，或创建新的流程开始规划</h2>
            <p style={emptySelectionTextStyle}>这里会展示流程画布、实时规划进度与运行控制。未进入具体流程前，编辑区保持欢迎页状态。</p>
            <button type="button" style={primaryButtonStyle} onClick={onCreateBlankFlow}>
              创建流程
            </button>
          </div>
        </div>
      ) : null}

      <div
        ref={bindCanvasViewportRef}
        style={
          isMobile
            ? {
                ...canvasViewportStyle,
                ...canvasViewportMobileStyle,
                paddingBottom: isPlannerExpanded ? '172px' : '24px',
              }
            : {
                ...canvasViewportStyle,
                paddingBottom: isPlannerExpanded ? '184px' : '28px',
              }
        }
        data-testid="flow-canvas-viewport"
        onDoubleClick={onCanvasDoubleClick}
        onPointerDown={onCanvasPointerDown}
      >
        <div style={{ ...canvasSurfaceStyle, width: `${canvasWidth}px`, height: `${canvasHeight}px` }}>
          <div style={{ ...stickyHeaderStyle, width: `${canvasWidth}px` }}>
            {laneLayouts.map((layout) => (
              <button
                key={layout.lane.id}
                type="button"
                data-flow-lane-title="true"
                style={{
                  ...laneHeaderCellStyle,
                  left: `${layout.left}px`,
                  width: `${layout.width}px`,
                }}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (!canEdit) {
                    return;
                  }
                  onOpenLaneEditModal(layout.lane.id);
                }}
                disabled={!canEdit}
              >
                <span style={laneHeaderNameStyle}>{layout.lane.name}</span>
                <span style={laneHeaderAgentStyle}>
                  {layout.lane.agentId
                    ? (
                      agentLabelByScope.get(buildAgentScopeKey(layout.lane.instanceId, layout.lane.agentId))
                      ?? `${layout.lane.instanceId || '-'} / ${layout.lane.agentId}`
                    )
                    : '未委派 Agent'}
                </span>
              </button>
            ))}
            {!isMobile ? <p style={laneHeaderHintStyle}>双击顶部空白可新增泳道</p> : null}
          </div>

          <div style={{ ...laneBodyStyle, height: `${bodyHeight}px` }}>
            {laneLayouts.map((layout) => (
              <div
                key={`lane-bg-${layout.lane.id}`}
                style={{
                  ...laneColumnStyle,
                  left: `${layout.left}px`,
                  width: `${layout.width}px`,
                  height: `${bodyHeight}px`,
                }}
              />
            ))}

            <svg width={canvasWidth} height={canvasHeight} style={edgeSvgStyle} aria-hidden="true">
              <defs>
                <marker
                  id="flow-edge-arrow"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(14, 116, 144, 0.82)" />
                </marker>
                <marker
                  id="flow-edge-arrow-selected"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(2, 132, 199, 0.96)" />
                </marker>
              </defs>
              {edgeRenderMetas.map((edge) => {
                const isSelected = edge.id === selectedEdgeId;
                return (
                  <g key={edge.id}>
                    <path
                      d={edge.path}
                      style={isSelected ? edgePathSelectedStyle : edgePathStyle}
                      markerEnd={isSelected ? 'url(#flow-edge-arrow-selected)' : 'url(#flow-edge-arrow)'}
                    />
                    <path
                      d={edge.path}
                      style={{
                        ...edgeHitPathStyle,
                        cursor: canEdit ? 'pointer' : 'default',
                      }}
                      data-flow-edge-path="true"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (!canEdit) {
                          return;
                        }
                        onSelectEdge(edge.id);
                      }}
                    />
                  </g>
                );
              })}
              {connectionPreviewPath ? <path d={connectionPreviewPath} style={edgePreviewPathStyle} /> : null}
            </svg>

            {flowNodes.map((node) => {
              const renderLayout = nodeRenderLayoutById.get(node.id);
              if (!renderLayout) {
                return null;
              }
              const isSelected = selectedNodeIdSet.has(node.id);
              const lane = laneById.get(renderLayout.laneId);
              const connectedSides = edgeConnectorUsageByNode.get(node.id);
              const shouldShowConnector = (side: ConnectorSide): boolean => {
                if (isSelected || isConnecting) {
                  return true;
                }
                return connectedSides?.has(side) ?? false;
              };
              return (
                <article
                  key={node.id}
                  role="button"
                  tabIndex={0}
                  data-flow-node-card="true"
                  aria-label={`流程节点-${node.title}`}
                  style={{
                    ...flowNodeCardStyle,
                    left: `${renderLayout.left}px`,
                    top: `${renderLayout.top}px`,
                    borderColor: isSelected ? 'rgba(14, 116, 144, 0.72)' : node.sensitive ? 'rgba(180, 83, 9, 0.46)' : 'rgba(15, 118, 110, 0.34)',
                    boxShadow: isSelected
                      ? '0 0 0 2px rgba(14, 116, 144, 0.26), 0 18px 34px -30px rgba(15, 23, 42, 0.9)'
                      : flowNodeCardStyle.boxShadow,
                  }}
                  onClick={(event) => {
                    onSelectNode(node.id, event.metaKey || event.ctrlKey);
                  }}
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (!canEdit) {
                      return;
                    }
                    onOpenNodeEditModal(node.id);
                  }}
                  onPointerDown={(event) => onNodePointerDown(event, node.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      if (!canEdit) {
                        return;
                      }
                      event.preventDefault();
                      onOpenNodeEditModal(node.id);
                    }
                  }}
                >
                  <div style={nodeHeaderStyle}>
                    {isSubmittedFlow || node.status !== 'queued' ? <span style={nodeStatusStyle}>{node.status}</span> : null}
                    <span style={nodeLaneStyle}>{lane?.name || '未命名泳道'}</span>
                  </div>
                  <h3 style={nodeTitleStyle}>{node.title}</h3>
                  <p style={nodeDescriptionStyle}>{(node.description ?? '').trim() || '未填写详细描述'}</p>
                  <p style={nodeMetaStyle}>{node.sensitive ? '敏感节点' : '普通节点'}</p>

                  {shouldShowConnector('top') ? (
                    <button
                      type="button"
                      data-flow-connector="true"
                      data-node-id={node.id}
                      data-side="top"
                      style={{ ...connectorStyle, ...connectorTopStyle, borderColor: connectionDrag?.from.nodeId === node.id && connectionDrag.from.side === 'top' ? '#0284c7' : connectorStyle.borderColor }}
                      onPointerDown={(event) => onConnectorPointerDown(event, { nodeId: node.id, side: 'top' })}
                      onPointerUp={(event) => onConnectorPointerUp(event, { nodeId: node.id, side: 'top' })}
                      aria-label={`节点 ${node.title} 顶部连接点`}
                      disabled={!canEdit}
                    />
                  ) : null}
                  {shouldShowConnector('right') ? (
                    <button
                      type="button"
                      data-flow-connector="true"
                      data-node-id={node.id}
                      data-side="right"
                      style={{ ...connectorStyle, ...connectorRightStyle, borderColor: connectionDrag?.from.nodeId === node.id && connectionDrag.from.side === 'right' ? '#0284c7' : connectorStyle.borderColor }}
                      onPointerDown={(event) => onConnectorPointerDown(event, { nodeId: node.id, side: 'right' })}
                      onPointerUp={(event) => onConnectorPointerUp(event, { nodeId: node.id, side: 'right' })}
                      aria-label={`节点 ${node.title} 右侧连接点`}
                      disabled={!canEdit}
                    />
                  ) : null}
                  {shouldShowConnector('bottom') ? (
                    <button
                      type="button"
                      data-flow-connector="true"
                      data-node-id={node.id}
                      data-side="bottom"
                      style={{ ...connectorStyle, ...connectorBottomStyle, borderColor: connectionDrag?.from.nodeId === node.id && connectionDrag.from.side === 'bottom' ? '#0284c7' : connectorStyle.borderColor }}
                      onPointerDown={(event) => onConnectorPointerDown(event, { nodeId: node.id, side: 'bottom' })}
                      onPointerUp={(event) => onConnectorPointerUp(event, { nodeId: node.id, side: 'bottom' })}
                      aria-label={`节点 ${node.title} 底部连接点`}
                      disabled={!canEdit}
                    />
                  ) : null}
                  {shouldShowConnector('left') ? (
                    <button
                      type="button"
                      data-flow-connector="true"
                      data-node-id={node.id}
                      data-side="left"
                      style={{ ...connectorStyle, ...connectorLeftStyle, borderColor: connectionDrag?.from.nodeId === node.id && connectionDrag.from.side === 'left' ? '#0284c7' : connectorStyle.borderColor }}
                      onPointerDown={(event) => onConnectorPointerDown(event, { nodeId: node.id, side: 'left' })}
                      onPointerUp={(event) => onConnectorPointerUp(event, { nodeId: node.id, side: 'left' })}
                      aria-label={`节点 ${node.title} 左侧连接点`}
                      disabled={!canEdit}
                    />
                  ) : null}
                </article>
              );
            })}
          </div>

          {flowNodes.length === 0 ? (
            <div style={emptyCanvasHintStyle}>
              <p style={emptyCanvasTextStyle}>双击顶部创建泳道，双击画布创建节点，节点连接后即可运行流程。</p>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
