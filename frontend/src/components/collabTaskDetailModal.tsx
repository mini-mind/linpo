import type React from 'react';

import { buildKanbanTaskOutputDownloadUrl } from '../api/client';
import type { SessionPreviewItem, TaskOutputPreviewResponse } from '../api/types';
import { MarkdownMessage } from './MarkdownMessage';
import { BinaryFilePreview, JsonPreview } from './collabOutputPreview';
import {
  buildMessageSummary,
  getMessageHint,
  getRoleLabel,
  getTaskSessionItemStyle,
  shouldRenderCollapsibleMessage,
} from './collabSessionMessageUtils';
import type { BoardTask } from './kanbanTypes';

export type TaskDetailTab = 'info' | 'stream' | 'output';

export type TaskOutputEntry = {
  id: string;
  title: string;
  value: string;
};

export type TaskDependencyEntry = {
  nodeId: string;
  title: string;
  statusLabel: string;
};

export type CollabTaskDetailModalStyles = {
  modalOverlayStyle: React.CSSProperties;
  modalOverlayMobileStyle: React.CSSProperties;
  taskDetailCardStyle: React.CSSProperties;
  taskDetailCardMobileStyle: React.CSSProperties;
  taskDetailTopRowStyle: React.CSSProperties;
  taskDetailTopRowMobileStyle: React.CSSProperties;
  taskDetailTopTitleBlockStyle: React.CSSProperties;
  modalTitleStyle: React.CSSProperties;
  taskDetailTitleStyle: React.CSSProperties;
  flatActionButtonStyle: React.CSSProperties;
  flatActionButtonMobileStyle: React.CSSProperties;
  taskDetailTabsStyle: React.CSSProperties;
  taskDetailTabsMobileStyle: React.CSSProperties;
  taskDetailTabButtonStyle: React.CSSProperties;
  taskDetailTabButtonActiveStyle: React.CSSProperties;
  taskDetailBodyStyle: React.CSSProperties;
  taskInfoPanelStyle: React.CSSProperties;
  taskDetailDescriptionWrapStyle: React.CSSProperties;
  taskDetailSectionTitleStyle: React.CSSProperties;
  taskDetailSummaryStyle: React.CSSProperties;
  taskKeyFieldsCardStyle: React.CSSProperties;
  taskDetailMetaGridStyle: React.CSSProperties;
  taskMetaFieldItemStyle: React.CSSProperties;
  taskMetaFieldLabelStyle: React.CSSProperties;
  taskMetaFieldValueStyle: React.CSSProperties;
  taskControlActionsStyle: React.CSSProperties;
  taskControlDangerButtonStyle: React.CSSProperties;
  taskControlPrimaryButtonStyle: React.CSSProperties;
  taskControlHintStyle: React.CSSProperties;
  dependencyListStyle: React.CSSProperties;
  dependencyItemStyle: React.CSSProperties;
  dependencyNameStyle: React.CSSProperties;
  dependencyStatusStyle: React.CSSProperties;
  taskOutputPanelStyle: React.CSSProperties;
  taskOutputHeaderStyle: React.CSSProperties;
  taskOutputLayoutStyle: React.CSSProperties;
  taskOutputLayoutMobileStyle: React.CSSProperties;
  taskOutputListStyle: React.CSSProperties;
  taskOutputListMobileStyle: React.CSSProperties;
  taskOutputItemButtonStyle: React.CSSProperties;
  taskOutputItemActiveStyle: React.CSSProperties;
  taskOutputItemTypeStyle: React.CSSProperties;
  taskOutputItemTitleStyle: React.CSSProperties;
  taskOutputPreviewStyle: React.CSSProperties;
  taskOutputMetaStyle: React.CSSProperties;
  taskOutputDownloadLinkStyle: React.CSSProperties;
  taskOutputMarkdownWrapStyle: React.CSSProperties;
  taskSessionErrorTextStyle: React.CSSProperties;
  taskSessionTextStyle: React.CSSProperties;
  taskSessionPanelStyle: React.CSSProperties;
  taskSessionHeaderStyle: React.CSSProperties;
  taskSessionListStyle: React.CSSProperties;
  taskSessionRoleStyle: React.CSSProperties;
  toolCallDetailsStyle: React.CSSProperties;
  toolCallSummaryStyle: React.CSSProperties;
  toolCallDetailBodyStyle: React.CSSProperties;
  toolCallDetailHintStyle: React.CSSProperties;
};

type CollabTaskDetailModalProps = {
  isMobile: boolean;
  boardRealtimeId: string;
  selectedTask: BoardTask;
  taskDetailTab: TaskDetailTab;
  onTaskDetailTabChange: (tab: TaskDetailTab) => void;
  onClose: () => void;
  dependencyEntries: TaskDependencyEntry[];
  canInterruptSelectedTask: boolean;
  canContinueSelectedTask: boolean;
  isInterruptingTaskId: string | null;
  isContinuingTaskId: string | null;
  onInterruptSelectedTask: () => void;
  onContinueSelectedTask: () => void;
  onDeleteTaskNode: (task: BoardTask) => void;
  formatTaskAgentLabel: (task: BoardTask) => string;
  getTaskExecutionSessionKey: (task: BoardTask) => string | null;
  outputEntries: TaskOutputEntry[];
  selectedOutputEntry: TaskOutputEntry | null;
  onSelectOutputEntryId: (id: string) => void;
  selectedOutputFileInlineUrl: string | null;
  isOutputPreviewLoading: boolean;
  outputPreviewError: string | null;
  outputPreview: TaskOutputPreviewResponse | null;
  isTaskSessionLoading: boolean;
  taskSessionError: string | null;
  taskSessionItems: SessionPreviewItem[];
  taskSessionListRef: React.RefObject<HTMLDivElement>;
  styles: CollabTaskDetailModalStyles;
};

export function CollabTaskDetailModal(props: CollabTaskDetailModalProps): JSX.Element {
  const {
    isMobile,
    boardRealtimeId,
    selectedTask,
    taskDetailTab,
    onTaskDetailTabChange,
    onClose,
    dependencyEntries,
    canInterruptSelectedTask,
    canContinueSelectedTask,
    isInterruptingTaskId,
    isContinuingTaskId,
    onInterruptSelectedTask,
    onContinueSelectedTask,
    onDeleteTaskNode,
    formatTaskAgentLabel,
    getTaskExecutionSessionKey,
    outputEntries,
    selectedOutputEntry,
    onSelectOutputEntryId,
    selectedOutputFileInlineUrl,
    isOutputPreviewLoading,
    outputPreviewError,
    outputPreview,
    isTaskSessionLoading,
    taskSessionError,
    taskSessionItems,
    taskSessionListRef,
    styles,
  } = props;

  return (
    <div style={isMobile ? { ...styles.modalOverlayStyle, ...styles.modalOverlayMobileStyle } : styles.modalOverlayStyle} role="dialog" aria-modal="true" aria-label="任务详情">
      <div style={isMobile ? { ...styles.taskDetailCardStyle, ...styles.taskDetailCardMobileStyle } : styles.taskDetailCardStyle}>
        <div style={isMobile ? { ...styles.taskDetailTopRowStyle, ...styles.taskDetailTopRowMobileStyle } : styles.taskDetailTopRowStyle}>
          <div style={styles.taskDetailTopTitleBlockStyle}>
            <h3 style={styles.modalTitleStyle}>任务详情</h3>
            <p style={styles.taskDetailTitleStyle}>{selectedTask.title}</p>
          </div>
          <button type="button" style={isMobile ? { ...styles.flatActionButtonStyle, ...styles.flatActionButtonMobileStyle } : styles.flatActionButtonStyle} onClick={onClose}>
            关闭
          </button>
        </div>

        <div style={isMobile ? { ...styles.taskDetailTabsStyle, ...styles.taskDetailTabsMobileStyle } : styles.taskDetailTabsStyle} role="tablist" aria-label="任务详情标签">
          <button
            type="button"
            role="tab"
            aria-selected={taskDetailTab === 'info'}
            style={{
              ...styles.taskDetailTabButtonStyle,
              ...(taskDetailTab === 'info' ? styles.taskDetailTabButtonActiveStyle : {}),
            }}
            onClick={() => onTaskDetailTabChange('info')}
          >
            基本信息
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={taskDetailTab === 'stream'}
            style={{
              ...styles.taskDetailTabButtonStyle,
              ...(taskDetailTab === 'stream' ? styles.taskDetailTabButtonActiveStyle : {}),
            }}
            onClick={() => onTaskDetailTabChange('stream')}
          >
            执行流程
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={taskDetailTab === 'output'}
            style={{
              ...styles.taskDetailTabButtonStyle,
              ...(taskDetailTab === 'output' ? styles.taskDetailTabButtonActiveStyle : {}),
            }}
            onClick={() => onTaskDetailTabChange('output')}
          >
            任务产出
          </button>
        </div>

        <div style={styles.taskDetailBodyStyle}>
          {taskDetailTab === 'info' ? (
            <section style={styles.taskInfoPanelStyle} aria-label="基本信息">
              <div style={styles.taskDetailDescriptionWrapStyle}>
                <p style={styles.taskDetailSectionTitleStyle}>任务描述</p>
                <p style={styles.taskDetailSummaryStyle}>{selectedTask.summary || '暂无描述'}</p>
              </div>

              <section style={styles.taskKeyFieldsCardStyle} aria-label="关键字段">
                <p style={styles.taskDetailSectionTitleStyle}>关键字段</p>
                <div style={styles.taskDetailMetaGridStyle}>
                  <article style={styles.taskMetaFieldItemStyle}>
                    <p style={styles.taskMetaFieldLabelStyle}>状态</p>
                    <p style={styles.taskMetaFieldValueStyle}>{selectedTask.status}</p>
                  </article>
                  <article style={styles.taskMetaFieldItemStyle}>
                    <p style={styles.taskMetaFieldLabelStyle}>来源</p>
                    <p style={styles.taskMetaFieldValueStyle}>{selectedTask.source === 'flow' ? 'Flow' : 'Provider'}</p>
                  </article>
                  <article style={styles.taskMetaFieldItemStyle}>
                    <p style={styles.taskMetaFieldLabelStyle}>Agent</p>
                    <p style={styles.taskMetaFieldValueStyle}>{formatTaskAgentLabel(selectedTask)}</p>
                  </article>
                  <article style={styles.taskMetaFieldItemStyle}>
                    <p style={styles.taskMetaFieldLabelStyle}>Agent ID</p>
                    <p style={styles.taskMetaFieldValueStyle}>{selectedTask.agentId ?? 'n/a'}</p>
                  </article>
                  <article style={styles.taskMetaFieldItemStyle}>
                    <p style={styles.taskMetaFieldLabelStyle}>会话</p>
                    <p style={styles.taskMetaFieldValueStyle}>
                      {getTaskExecutionSessionKey(selectedTask) ?? '当前节点未绑定 execution_session_key'}
                    </p>
                  </article>
                </div>
                <div style={styles.taskControlActionsStyle}>
                  {selectedTask.status === 'running' ? (
                    <button
                      type="button"
                      style={styles.taskControlDangerButtonStyle}
                      onClick={onInterruptSelectedTask}
                      disabled={!canInterruptSelectedTask || isInterruptingTaskId === selectedTask.id}
                    >
                      {isInterruptingTaskId === selectedTask.id ? '中断中...' : '中断'}
                    </button>
                  ) : null}
                  {selectedTask.status === 'blocked_by_approval' ? (
                    <button
                      type="button"
                      style={styles.taskControlPrimaryButtonStyle}
                      onClick={onContinueSelectedTask}
                      disabled={!canContinueSelectedTask || isContinuingTaskId === selectedTask.id}
                    >
                      {isContinuingTaskId === selectedTask.id ? '继续中...' : '继续'}
                    </button>
                  ) : null}
                  {selectedTask.status === 'queued' ? (
                    <button type="button" style={styles.flatActionButtonStyle} onClick={() => onDeleteTaskNode(selectedTask)}>
                      删除节点
                    </button>
                  ) : null}
                  {selectedTask.status !== 'running'
                  && selectedTask.status !== 'queued'
                  && selectedTask.status !== 'blocked_by_approval' ? (
                    <p style={styles.taskControlHintStyle}>当前状态无可执行控制动作</p>
                  ) : null}
                </div>
              </section>

              <div style={styles.taskDetailDescriptionWrapStyle}>
                <p style={styles.taskDetailSectionTitleStyle}>依赖节点</p>
                {dependencyEntries.length === 0 ? (
                  <p style={styles.taskDetailSummaryStyle}>无</p>
                ) : (
                  <ul style={styles.dependencyListStyle}>
                    {dependencyEntries.map((item) => (
                      <li key={item.nodeId} style={styles.dependencyItemStyle}>
                        <span style={styles.dependencyNameStyle}>{item.title}</span>
                        <span style={styles.dependencyStatusStyle}>{item.statusLabel}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          ) : null}

          {taskDetailTab === 'output' ? (
            <section style={styles.taskOutputPanelStyle} aria-label="任务产出">
              <div style={styles.taskOutputHeaderStyle}>
                <p style={styles.taskDetailSectionTitleStyle}>任务产出</p>
              </div>
              {outputEntries.length === 0 ? (
                <p style={styles.taskDetailSummaryStyle}>暂无任务产出。请由 Agent 在完成回调中显式上报 artifact 文件路径。</p>
              ) : (
                <div style={isMobile ? styles.taskOutputLayoutMobileStyle : styles.taskOutputLayoutStyle}>
                  <aside style={isMobile ? styles.taskOutputListMobileStyle : styles.taskOutputListStyle}>
                    {outputEntries.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        style={{
                          ...styles.taskOutputItemButtonStyle,
                          ...(selectedOutputEntry?.id === entry.id ? styles.taskOutputItemActiveStyle : {}),
                        }}
                        onClick={() => onSelectOutputEntryId(entry.id)}
                      >
                        <span style={styles.taskOutputItemTypeStyle}>文件</span>
                        <span style={styles.taskOutputItemTitleStyle}>{entry.title}</span>
                      </button>
                    ))}
                  </aside>
                  <div style={styles.taskOutputPreviewStyle}>
                    {selectedOutputEntry ? (
                      <div style={styles.taskOutputMetaStyle}>
                        <span style={styles.taskDetailSummaryStyle}>{selectedOutputEntry.value}</span>
                        <a
                          href={buildKanbanTaskOutputDownloadUrl(
                            selectedTask.id,
                            selectedOutputEntry.value,
                            selectedTask.instanceId ? { instanceId: selectedTask.instanceId } : undefined,
                            boardRealtimeId
                          )}
                          style={styles.taskOutputDownloadLinkStyle}
                          target="_blank"
                          rel="noreferrer"
                        >
                          下载
                        </a>
                      </div>
                    ) : null}
                    {isOutputPreviewLoading ? <p style={styles.taskDetailSummaryStyle}>加载预览...</p> : null}
                    {outputPreviewError ? <p style={styles.taskSessionErrorTextStyle}>{outputPreviewError}</p> : null}
                    {!isOutputPreviewLoading && !outputPreviewError && outputPreview ? (
                      outputPreview.kind === 'json' ? (
                        <div style={styles.taskOutputMarkdownWrapStyle}>
                          <JsonPreview content={outputPreview.content ?? ''} markdownStyle={styles.taskSessionTextStyle} />
                        </div>
                      ) : outputPreview.kind === 'text' ? (
                        <div style={styles.taskOutputMarkdownWrapStyle}>
                          <MarkdownMessage text={outputPreview.content ?? ''} style={styles.taskSessionTextStyle} />
                        </div>
                      ) : (
                        <BinaryFilePreview
                          mimeType={outputPreview.mime_type}
                          fileUrl={selectedOutputFileInlineUrl}
                          emptyTextStyle={styles.taskDetailSummaryStyle}
                        />
                      )
                    ) : null}
                  </div>
                </div>
              )}
            </section>
          ) : null}

          {taskDetailTab === 'stream' ? (
            <section style={styles.taskSessionPanelStyle} aria-label="执行消息流">
              <div style={styles.taskSessionHeaderStyle}>
                <p style={styles.taskDetailSectionTitleStyle}>执行消息流</p>
              </div>
              {isTaskSessionLoading && taskSessionItems.length === 0 ? (
                <p style={styles.taskDetailSummaryStyle}>加载消息...</p>
              ) : null}
              {taskSessionError ? <p style={styles.taskSessionErrorTextStyle}>{taskSessionError}</p> : null}
              {!taskSessionError && taskSessionItems.length === 0 && !isTaskSessionLoading ? (
                <p style={styles.taskDetailSummaryStyle}>暂无消息</p>
              ) : null}
              {!taskSessionError && taskSessionItems.length > 0 ? (
                <div ref={taskSessionListRef} style={styles.taskSessionListStyle}>
                  {taskSessionItems.map((item, index) => (
                    <article
                      key={`${selectedTask.id}-msg-${index}-${item.role}`}
                      style={getTaskSessionItemStyle(item.role, item.text)}
                    >
                      <span style={styles.taskSessionRoleStyle}>{getRoleLabel(item.role, item.text)}</span>
                      {shouldRenderCollapsibleMessage(item.role, item.text) ? (
                        <CollapsibleMessage
                          text={item.text}
                          summary={buildMessageSummary(item.role, item.text)}
                          hint={getMessageHint(item.role, item.text)}
                          styles={styles}
                        />
                      ) : (
                        <MarkdownMessage text={item.text} style={styles.taskSessionTextStyle} />
                      )}
                    </article>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CollapsibleMessage({
  text,
  summary,
  hint,
  styles,
}: {
  text: string;
  summary: string;
  hint: string;
  styles: CollabTaskDetailModalStyles;
}): JSX.Element {
  return (
    <details style={styles.toolCallDetailsStyle}>
      <summary style={styles.toolCallSummaryStyle}>{summary}</summary>
      <div style={styles.toolCallDetailBodyStyle}>
        <p style={styles.toolCallDetailHintStyle}>{hint}</p>
        <MarkdownMessage text={text} style={styles.taskSessionTextStyle} />
      </div>
    </details>
  );
}
