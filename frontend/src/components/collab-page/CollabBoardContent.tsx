import type React from 'react';

import { resolveFlowColumnState, type BoardColumn } from '../collabKanbanColumnsUtils';
import type { BoardTask, BoardViewMode } from '../kanbanTypes';
import {
  addAgentBodyStyle,
  addAgentColumnStyle,
  addAgentHeaderButtonStyle,
  addAgentHintStyle,
  boardShellMobileStyle,
  boardShellStyle,
  collapsedColumnBodyStyle,
  collapsedColumnFadeStyle,
  collapsedColumnStyle,
  collapsedColumnTopPlaceholderStyle,
  collapsedColumnTopStyle,
  columnBodyStyle,
  columnHeaderActionStyle,
  columnHeaderStyle,
  columnStyle,
  columnCountStyle,
  columnTitleRowStyle,
  columnTitleStyle,
  continueFlowButtonStyle,
  emptyTextStyle,
  errorMessageStyle,
  errorPanelStyle,
  errorTitleStyle,
  flowColumnStatePillStyle,
  getBoardTrackStyle,
  getBoardViewportStyle,
  interruptFlowButtonStyle,
  mobileAddAgentBodyStyle,
  mobileAddAgentColumnStyle,
  mobileCollapsedColumnStyle,
  mobileColumnBodyStyle,
  mobileColumnStyle,
  pendingConfirmationColumnHeaderStyle,
  pendingConfirmationCreateButtonStyle,
  runFlowButtonStyle,
  singleColumnStyle,
  taskArtifactStyle,
  taskCardButtonStyle,
  taskCardHeaderStyle,
  taskCardStyle,
  taskMetaStyle,
  taskSourceTagStyle,
  taskStatusTextStyle,
  taskSummaryStyle,
  taskTitleStyle,
} from './styles';

type CollabBoardContentProps = {
  isMobile: boolean;
  isNarrowMobileBoard: boolean;
  loadError: string | null;
  viewMode: BoardViewMode;
  loading: boolean;
  visibleBoardColumns: BoardColumn[];
  collapsedColumnIds: string[];
  interruptingFlowId: string | null;
  continuingFlowId: string | null;
  runningFlowId: string | null;
  onBoardTouchStart: (event: React.TouchEvent<HTMLDivElement>) => void;
  onBoardTouchEnd: (event: React.TouchEvent<HTMLDivElement>) => void;
  onToggleColumnCollapsed: (columnId: string) => void;
  onOpenCreateModal: () => void;
  onInterruptFlow: (flowId: string, title: string) => void;
  onContinueFlow: (flowId: string, title: string) => void;
  onRunFlow: (flowId: string, title: string, tasks: BoardTask[]) => void;
  onOpenTaskDetail: (task: BoardTask) => void;
  onOpenAddAgentModal: () => void;
  getFlowColumnStateLabel: (state: ReturnType<typeof resolveFlowColumnState>) => string;
  formatTaskAgentLabel: (task: BoardTask) => string;
  getTaskRequirementIdForCard: (task: BoardTask) => string;
};

export function CollabBoardContent(props: CollabBoardContentProps): JSX.Element {
  const {
    isMobile,
    isNarrowMobileBoard,
    loadError,
    viewMode,
    loading,
    visibleBoardColumns,
    collapsedColumnIds,
    interruptingFlowId,
    continuingFlowId,
    runningFlowId,
    onBoardTouchStart,
    onBoardTouchEnd,
    onToggleColumnCollapsed,
    onOpenCreateModal,
    onInterruptFlow,
    onContinueFlow,
    onRunFlow,
    onOpenTaskDetail,
    onOpenAddAgentModal,
    getFlowColumnStateLabel,
    formatTaskAgentLabel,
    getTaskRequirementIdForCard,
  } = props;

  // 组件边界：只渲染看板内容，不管理业务状态，所有动作回调均由父组件注入。
  return (
    <div style={isMobile ? boardShellMobileStyle : boardShellStyle}>
      {loadError ? (
        <div style={errorPanelStyle}>
          <p style={errorTitleStyle}>看板数据加载失败</p>
          <p style={errorMessageStyle}>{loadError}</p>
        </div>
      ) : null}

      <div
        style={getBoardViewportStyle({ isMobile, isNarrowMobileBoard })}
        data-testid="kanban-board"
        onTouchStart={onBoardTouchStart}
        onTouchEnd={onBoardTouchEnd}
      >
        <div style={getBoardTrackStyle({ isMobile, isNarrowMobileBoard })}>
          {visibleBoardColumns.map((column) => {
            const isCollapsed = isNarrowMobileBoard ? false : collapsedColumnIds.includes(column.id);
            return (
              <article
                key={column.id}
                style={
                  isCollapsed
                    ? (isMobile ? mobileCollapsedColumnStyle : collapsedColumnStyle)
                    : isNarrowMobileBoard
                      ? singleColumnStyle
                      : (isMobile ? mobileColumnStyle : columnStyle)
                }
                data-column-collapsed={isCollapsed ? 'true' : 'false'}
                onDoubleClick={!isNarrowMobileBoard && isCollapsed ? () => onToggleColumnCollapsed(column.id) : undefined}
                title={isCollapsed ? `展开列 ${column.title}` : undefined}
              >
                {isCollapsed ? (
                  <>
                    <div style={collapsedColumnTopStyle}>
                      <span style={collapsedColumnTopPlaceholderStyle}>...</span>
                    </div>
                    <div style={collapsedColumnBodyStyle} aria-hidden="true">
                      <div style={collapsedColumnFadeStyle} />
                    </div>
                  </>
                ) : (
                  <>
                    <header
                      style={
                        viewMode === 'status' && column.id === 'status:pending_confirmation'
                          ? { ...columnHeaderStyle, ...pendingConfirmationColumnHeaderStyle }
                          : columnHeaderStyle
                      }
                      onDoubleClick={!isNarrowMobileBoard ? () => onToggleColumnCollapsed(column.id) : undefined}
                      title={!isNarrowMobileBoard ? `折叠列 ${column.title}` : undefined}
                    >
                      <div style={columnTitleRowStyle}>
                        <h3 style={columnTitleStyle}>{column.title}</h3>
                        <span style={columnCountStyle}>{column.tasks.length}</span>
                      </div>
                      <div style={columnHeaderActionStyle}>
                        {viewMode === 'status' && column.id === 'status:pending_confirmation' ? (
                          <button
                            type="button"
                            style={pendingConfirmationCreateButtonStyle}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              onOpenCreateModal();
                            }}
                            onDoubleClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                            }}
                            aria-label="创建任务"
                          >
                            +
                          </button>
                        ) : null}
                        {viewMode === 'flow' && column.flowId ? (
                          <>
                            <span style={flowColumnStatePillStyle}>
                              {getFlowColumnStateLabel(column.flowState ?? resolveFlowColumnState(column.tasks))}
                            </span>
                            {(column.flowState ?? resolveFlowColumnState(column.tasks)) === 'running' ? (
                              <button
                                type="button"
                                style={interruptFlowButtonStyle}
                                aria-label={`中断流程 ${column.title}`}
                                onClick={() => onInterruptFlow(column.flowId as string, column.title)}
                                onDoubleClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                }}
                                disabled={interruptingFlowId === column.flowId || continuingFlowId === column.flowId}
                              >
                                {interruptingFlowId === column.flowId ? '中断中...' : '中断流程'}
                              </button>
                            ) : null}
                            {(column.flowState ?? resolveFlowColumnState(column.tasks)) === 'blocked' ? (
                              <button
                                type="button"
                                style={continueFlowButtonStyle}
                                aria-label={`继续流程 ${column.title}`}
                                onClick={() => onContinueFlow(column.flowId as string, column.title)}
                                onDoubleClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                }}
                                disabled={continuingFlowId === column.flowId || interruptingFlowId === column.flowId}
                              >
                                {continuingFlowId === column.flowId ? '继续中...' : '继续流程'}
                              </button>
                            ) : null}
                            {(column.flowState ?? resolveFlowColumnState(column.tasks)) === 'idle' ? (
                              <button
                                type="button"
                                style={runFlowButtonStyle}
                                aria-label={`运行流程 ${column.title}`}
                                onClick={() => onRunFlow(column.flowId as string, column.title, column.tasks)}
                                onDoubleClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                }}
                                disabled={
                                  runningFlowId === column.flowId
                                  || continuingFlowId === column.flowId
                                  || interruptingFlowId === column.flowId
                                  || column.tasks.length === 0
                                }
                                title={column.tasks.length === 0 ? '当前流程缺少可运行节点' : '按当前流程节点重新入队'}
                              >
                                {runningFlowId === column.flowId ? '运行中...' : '运行流程'}
                              </button>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    </header>
                    <div style={isMobile ? mobileColumnBodyStyle : columnBodyStyle}>
                      {loading ? (
                        <p style={emptyTextStyle}>同步中...</p>
                      ) : column.tasks.length === 0 ? (
                        <p style={emptyTextStyle}>
                          {viewMode === 'status' && column.id === 'status:pending_confirmation'
                            ? '从这里创建新的待执行任务。'
                            : '暂无任务'}
                        </p>
                      ) : (
                        column.tasks.map((task) => (
                          <article key={task.id} style={taskCardStyle}>
                            <button
                              type="button"
                              style={taskCardButtonStyle}
                              onClick={() => onOpenTaskDetail(task)}
                              aria-label={`查看任务 ${task.title}`}
                            >
                              <div style={taskCardHeaderStyle}>
                                <span style={taskSourceTagStyle}>{task.source === 'flow' ? 'Flow' : 'Provider'}</span>
                                <span style={taskStatusTextStyle}>{task.status}</span>
                              </div>
                              <h4 style={taskTitleStyle}>{task.title}</h4>
                              <p style={taskSummaryStyle}>{task.summary}</p>
                              <p style={taskMetaStyle}>Agent：{formatTaskAgentLabel(task)}</p>
                              <p style={taskMetaStyle}>任务ID：{task.id}</p>
                              <p style={taskMetaStyle}>requirement_id：{getTaskRequirementIdForCard(task)}</p>
                              {task.artifacts.length > 0 ? (
                                <p style={taskArtifactStyle}>{task.artifacts[0]}</p>
                              ) : null}
                            </button>
                          </article>
                        ))
                      )}
                    </div>
                  </>
                )}
              </article>
            );
          })}

          {viewMode === 'agent' && !isNarrowMobileBoard ? (
            <article style={isMobile ? mobileAddAgentColumnStyle : addAgentColumnStyle}>
              <header style={columnHeaderStyle}>
                <h3 style={columnTitleStyle}>新增 Agent</h3>
                <button
                  type="button"
                  style={addAgentHeaderButtonStyle}
                  aria-label="打开新增 Agent"
                  onClick={onOpenAddAgentModal}
                >
                  + 新增
                </button>
              </header>
              <div style={isMobile ? mobileAddAgentBodyStyle : addAgentBodyStyle}>
                <p style={addAgentHintStyle}>创建主 Agent 列，后续任务可直接投放。</p>
              </div>
            </article>
          ) : null}
        </div>
      </div>
    </div>
  );
}
