import type React from 'react';

import type { FlowSidebarItem, FlowSidebarMode } from './flowPageViewTypes';
import {
  flowSidebarHeaderStyle,
  flowSidebarHeaderDrawerStyle,
  flowSidebarHeaderTopRowStyle,
  flowSidebarTitleStyle,
  flowSidebarTitleDrawerStyle,
  flowSidebarHeaderActionsStyle,
  flowSidebarHeaderActionsDrawerStyle,
  sidebarGhostButtonStyle,
  sidebarPrimaryButtonStyle,
  sidebarButtonDrawerStyle,
  flowSidebarListStyle,
  flowSidebarListDrawerStyle,
  flowSidebarSectionListStyle,
  flowSidebarItemCardStyle,
  flowSidebarItemCardDrawerStyle,
  flowSidebarEmptyStyle,
  flowSidebarEmptyDrawerStyle,
  flowSidebarItemStyle,
  flowSidebarItemDrawerStyle,
  flowSidebarItemActiveStyle,
  flowSidebarItemBodyButtonStyle,
  flowSidebarItemBodyButtonDrawerStyle,
  flowSidebarItemTitleStyle,
  flowSidebarItemTitleDrawerStyle,
  flowSidebarItemMetaStyle,
  flowSidebarItemMetaDrawerStyle,
  flowSidebarDraftSyncErrorStyle,
  flowSidebarDraftSyncErrorDrawerStyle,
  flowSidebarItemEditButtonStyle,
  flowSidebarItemEditButtonDrawerStyle,
  flowSidebarItemRunButtonStyle,
  flowSidebarItemRunButtonDrawerStyle,
} from '../flowPageStyles';

type FlowSidebarNavigateOptions = {
  prefer_submitted_snapshot?: boolean;
};

type FlowSidebarProps = {
  mode: FlowSidebarMode;
  currentFlowId: string;
  orderedFlowSidebarItems: FlowSidebarItem[];
  flowNodesLength: number;
  isSubmittingFlow: boolean;
  isPlanning: boolean;
  isFlowActioning: boolean;
  isDraftCanvas: boolean;
  draftSyncStatusMessage: string;
  onCreateBlankFlow: () => void;
  onCloseDrawer: () => void;
  onNavigateToFlowEditor: (flowId: string, routeState?: FlowSidebarNavigateOptions) => void;
  onOpenFlowDetailFromSidebar: (flowId: string) => void;
  onSidebarCardDragStart: (flowId: string) => (event: React.DragEvent<HTMLElement>) => void;
  onSidebarCardDragOver: (event: React.DragEvent<HTMLElement>) => void;
  onSidebarCardDrop: (targetFlowId: string) => (event: React.DragEvent<HTMLElement>) => void;
  onSidebarCardDragEnd: () => void;
  onOpenSubmitConfirm: () => void;
  mobileDrawerCloseButtonRef: (node: HTMLButtonElement | null) => void;
  activeDrawerFlowButtonRef: (node: HTMLButtonElement | null) => void;
};

const flowSidebarSourceTagStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  width: 'fit-content',
  padding: '0.16rem 0.42rem',
  borderRadius: '999px',
  fontSize: '0.64rem',
  fontWeight: 700,
  color: '#0f766e',
  background: 'rgba(15, 118, 110, 0.12)',
};

export function FlowSidebar(props: FlowSidebarProps): JSX.Element {
  const {
    mode,
    currentFlowId,
    orderedFlowSidebarItems,
    flowNodesLength,
    isSubmittingFlow,
    isPlanning,
    isFlowActioning,
    isDraftCanvas,
    draftSyncStatusMessage,
    onCreateBlankFlow,
    onCloseDrawer,
    onNavigateToFlowEditor,
    onOpenFlowDetailFromSidebar,
    onSidebarCardDragStart,
    onSidebarCardDragOver,
    onSidebarCardDrop,
    onSidebarCardDragEnd,
    onOpenSubmitConfirm,
    mobileDrawerCloseButtonRef,
    activeDrawerFlowButtonRef,
  } = props;

  const isDrawerMode = mode === 'drawer';
  const normalizedCurrentFlowId = currentFlowId.trim();
  // 这里保持“纯展示 + 事件透传”，业务状态决策（导航、删除、提交流程）仍由 FlowPage 统一管理。

  return (
    <>
      <div style={isDrawerMode ? { ...flowSidebarHeaderStyle, ...flowSidebarHeaderDrawerStyle } : flowSidebarHeaderStyle}>
        <div style={flowSidebarHeaderTopRowStyle}>
          <h2 style={isDrawerMode ? { ...flowSidebarTitleStyle, ...flowSidebarTitleDrawerStyle } : flowSidebarTitleStyle}>流程列表</h2>
          <div style={isDrawerMode ? { ...flowSidebarHeaderActionsStyle, ...flowSidebarHeaderActionsDrawerStyle } : flowSidebarHeaderActionsStyle}>
            <button
              type="button"
              style={isDrawerMode ? { ...sidebarPrimaryButtonStyle, ...sidebarButtonDrawerStyle } : sidebarPrimaryButtonStyle}
              onClick={onCreateBlankFlow}
            >
              新建
            </button>
            {isDrawerMode ? (
              <button
                type="button"
                style={{ ...sidebarGhostButtonStyle, ...sidebarButtonDrawerStyle }}
                onClick={onCloseDrawer}
                ref={mobileDrawerCloseButtonRef}
              >
                关闭
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <div style={isDrawerMode ? { ...flowSidebarListStyle, ...flowSidebarListDrawerStyle } : flowSidebarListStyle}>
        {orderedFlowSidebarItems.length === 0 ? (
          <div style={isDrawerMode ? { ...flowSidebarEmptyStyle, ...flowSidebarEmptyDrawerStyle } : flowSidebarEmptyStyle}>暂无流程，点击新建开始编辑。</div>
        ) : (
          <div style={flowSidebarSectionListStyle}>
            {orderedFlowSidebarItems.map((item) => {
              const isActive = item.id === normalizedCurrentFlowId;
              const sourceTagLabel = (item.hasSubmitted && item.hasDraft) ? '已提交 + 草稿' : item.hasSubmitted ? '已提交' : '草稿';
              const shouldShowStatusLabel = !(sourceTagLabel === '草稿' && item.statusLabel === '草稿');
              // 保持原有“运行”按钮门禁：仅当前激活流程且满足可运行条件时允许点击。
              const isActiveFlowRunnable =
                isActive
                && flowNodesLength > 0
                && !isSubmittingFlow
                && !isPlanning
                && !isFlowActioning
                && item.statusLabel !== '运行中'
                && item.statusLabel !== '阻塞';

              return (
                <article
                  key={item.id}
                  draggable
                  onDragStart={onSidebarCardDragStart(item.id)}
                  onDragOver={onSidebarCardDragOver}
                  onDrop={onSidebarCardDrop(item.id)}
                  onDragEnd={onSidebarCardDragEnd}
                  data-testid={`flow-sidebar-card-${item.id}`}
                  style={isDrawerMode ? { ...flowSidebarItemCardStyle, ...flowSidebarItemCardDrawerStyle } : flowSidebarItemCardStyle}
                >
                  <button
                    type="button"
                    style={
                      isActive
                        ? {
                            ...(isDrawerMode
                              ? { ...flowSidebarItemStyle, ...flowSidebarItemDrawerStyle, ...flowSidebarItemBodyButtonDrawerStyle }
                              : { ...flowSidebarItemStyle, ...flowSidebarItemBodyButtonStyle }),
                            ...flowSidebarItemActiveStyle,
                          }
                        : isDrawerMode
                          ? { ...flowSidebarItemStyle, ...flowSidebarItemDrawerStyle, ...flowSidebarItemBodyButtonDrawerStyle }
                          : { ...flowSidebarItemStyle, ...flowSidebarItemBodyButtonStyle }
                    }
                    onClick={() =>
                      // 维持原行为：已提交流程切换时透传 prefer_submitted_snapshot。
                      onNavigateToFlowEditor(
                        item.id,
                        item.hasSubmitted ? { prefer_submitted_snapshot: true } : undefined
                      )
                    }
                    aria-label={`切换流程-${item.name}`}
                    aria-current={isActive ? 'page' : undefined}
                    ref={isDrawerMode && isActive ? activeDrawerFlowButtonRef : undefined}
                  >
                    <span style={flowSidebarSourceTagStyle}>
                      {sourceTagLabel}
                    </span>
                    <span style={isDrawerMode ? { ...flowSidebarItemTitleStyle, ...flowSidebarItemTitleDrawerStyle } : flowSidebarItemTitleStyle}>{item.name}</span>
                    {shouldShowStatusLabel ? (
                      <span style={isDrawerMode ? { ...flowSidebarItemMetaStyle, ...flowSidebarItemMetaDrawerStyle } : flowSidebarItemMetaStyle}>
                        {item.statusLabel}
                      </span>
                    ) : null}
                    {isActive && isDraftCanvas && draftSyncStatusMessage ? (
                      <span
                        data-testid="flow-draft-sync-status"
                        style={isDrawerMode ? flowSidebarDraftSyncErrorDrawerStyle : flowSidebarDraftSyncErrorStyle}
                      >
                        {draftSyncStatusMessage}
                      </span>
                    ) : null}
                    <span style={isDrawerMode ? { ...flowSidebarItemMetaStyle, ...flowSidebarItemMetaDrawerStyle } : flowSidebarItemMetaStyle}>节点 {item.nodeCount}</span>
                  </button>
                  <button
                    type="button"
                    style={isDrawerMode ? { ...flowSidebarItemEditButtonStyle, ...flowSidebarItemEditButtonDrawerStyle } : flowSidebarItemEditButtonStyle}
                    onClick={() => onOpenFlowDetailFromSidebar(item.id)}
                    aria-label={`编辑流程-${item.name}`}
                  >
                    编辑
                  </button>
                  {isActive ? (
                    <button
                      type="button"
                      style={isDrawerMode ? { ...flowSidebarItemRunButtonStyle, ...flowSidebarItemRunButtonDrawerStyle } : flowSidebarItemRunButtonStyle}
                      onClick={onOpenSubmitConfirm}
                      disabled={!isActiveFlowRunnable}
                      aria-label={`运行流程-${item.name}`}
                    >
                      {isSubmittingFlow ? '运行中...' : '运行'}
                    </button>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
