import type React from 'react';
import { MarkdownMessage } from '../MarkdownMessage';
import type {
  AggregateOverviewAgentItem,
  FlowChatMessageItem,
} from '../../api/types';
import {
  floatingPlannerMessagesStyle,
  floatingPlannerShellStyle,
  floatingPlannerShellMobileStyle,
  floatingPlannerCardStyle,
  floatingPlannerCardMobileStyle,
  floatingPlannerCardCollapsedStyle,
  floatingPlannerCardCollapsedMobileStyle,
  plannerMessageUserCardStyle,
  plannerMessageAssistantCardStyle,
  plannerMessageSystemCardStyle,
  plannerMessageRoleStyle,
  plannerMessageTextStyle,
  plannerComposerInlineStyle,
  plannerComposerTextareaInlineStyle,
  plannerComposerTextareaCollapsedStyle,
  plannerComposerFooterStyle,
  plannerComposerFooterMobileStyle,
  plannerComposerHintStyle,
  plannerComposerHintMobileStyle,
  plannerComposerHintDividerStyle,
  primaryButtonStyle,
} from '../flowPageStyles';

const plannerComposerFooterMetaStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.65rem',
  minWidth: 0,
};

const plannerAgentSelectStyle: React.CSSProperties = {
  appearance: 'none',
  border: '1px solid rgba(148, 163, 184, 0.45)',
  borderRadius: '0.65rem',
  background: 'rgba(255, 255, 255, 0.9)',
  color: '#0f172a',
  fontSize: '0.78rem',
  fontWeight: 600,
  lineHeight: 1.2,
  padding: '0.38rem 0.72rem',
  maxWidth: '180px',
};

type FlowPlannerPanelProps = {
  plannerShellRef: (node: HTMLDivElement | null) => void;
  plannerMessagesRef: (node: HTMLDivElement | null) => void;
  isMobile: boolean;
  isPlannerExpanded: boolean;
  plannerMessages: FlowChatMessageItem[];
  plannerInput: string;
  canTypePlannerInput: boolean;
  selectedExecutorAgentId: string;
  uniqueAgents: AggregateOverviewAgentItem[];
  isOverviewLoading: boolean;
  isOverviewLoadFailed: boolean;
  canPromptPlanner: boolean;
  isPlannerStopActionActive: boolean;
  isPlannerStopping: boolean;
  onExpand: () => void;
  onPlannerInputChange: (value: string) => void;
  onPlannerInputKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSelectedExecutorAgentIdChange: (agentId: string) => void;
  onSubmitOrStop: () => void;
  resolveMessageRoleLabel: (message: FlowChatMessageItem) => string;
  resolveMessageDisplayText: (message: FlowChatMessageItem) => string;
};

export function FlowPlannerPanel({
  plannerShellRef,
  plannerMessagesRef,
  isMobile,
  isPlannerExpanded,
  plannerMessages,
  plannerInput,
  canTypePlannerInput,
  selectedExecutorAgentId,
  uniqueAgents,
  isOverviewLoading,
  isOverviewLoadFailed,
  canPromptPlanner,
  isPlannerStopActionActive,
  isPlannerStopping,
  onExpand,
  onPlannerInputChange,
  onPlannerInputKeyDown,
  onSelectedExecutorAgentIdChange,
  onSubmitOrStop,
  resolveMessageRoleLabel,
  resolveMessageDisplayText,
}: FlowPlannerPanelProps) {
  // 仅负责展示层交互：在用户触达面板时通知父组件展开，不在子组件内维护业务状态。
  const ensureExpanded = () => {
    if (!isPlannerExpanded) {
      onExpand();
    }
  };

  return (
    <div
      ref={plannerShellRef}
      style={isMobile ? floatingPlannerShellMobileStyle : floatingPlannerShellStyle}
      data-testid="flow-planner-shell"
    >
      <div
        data-testid="flow-planner-card"
        style={
          isMobile
            ? {
                ...(isPlannerExpanded
                  ? { ...floatingPlannerCardStyle, ...floatingPlannerCardMobileStyle }
                  : { ...floatingPlannerCardCollapsedStyle, ...floatingPlannerCardCollapsedMobileStyle }),
              }
            : isPlannerExpanded
              ? floatingPlannerCardStyle
              : floatingPlannerCardCollapsedStyle
        }
        onPointerDown={ensureExpanded}
      >
        {isPlannerExpanded ? (
          <div
            ref={plannerMessagesRef}
            style={floatingPlannerMessagesStyle}
            data-testid="flow-planner-messages"
            tabIndex={0}
          >
            {plannerMessages.length > 0
              ? (
                plannerMessages.map((message, index) => (
                  <article
                    key={`${message.created_at}-${message.role}-${message.kind ?? 'message'}-${index}`}
                    style={
                      message.role === 'user'
                        ? plannerMessageUserCardStyle
                        : message.role === 'system'
                          ? plannerMessageSystemCardStyle
                          : plannerMessageAssistantCardStyle
                    }
                  >
                    <span style={plannerMessageRoleStyle}>
                      {resolveMessageRoleLabel(message)}
                    </span>
                    <MarkdownMessage text={resolveMessageDisplayText(message)} style={plannerMessageTextStyle} />
                  </article>
                ))
              )
              : null}
          </div>
        ) : null}
        <div style={plannerComposerInlineStyle} role="group" aria-label="流程规划对话框">
          <textarea
            value={plannerInput}
            onChange={(event) => {
              ensureExpanded();
              onPlannerInputChange(event.target.value);
            }}
            onFocus={ensureExpanded}
            onClick={ensureExpanded}
            onKeyDown={onPlannerInputKeyDown}
            style={isPlannerExpanded ? plannerComposerTextareaInlineStyle : plannerComposerTextareaCollapsedStyle}
            rows={isPlannerExpanded ? 4 : 1}
            placeholder="输入您的需求，自动规划流程"
            aria-label="流程规划输入框"
            data-testid="flow-planner-input"
            disabled={!canTypePlannerInput}
          />
          {isPlannerExpanded ? (
            <div style={isMobile ? { ...plannerComposerFooterStyle, ...plannerComposerFooterMobileStyle } : plannerComposerFooterStyle}>
              <div style={plannerComposerFooterMetaStyle}>
                <select
                  value={selectedExecutorAgentId}
                  onChange={(event) => onSelectedExecutorAgentIdChange(event.target.value)}
                  style={plannerAgentSelectStyle}
                  aria-label="流程执行 Agent"
                  data-testid="flow-planner-agent-select"
                  disabled={isOverviewLoading}
                >
                  {isOverviewLoading ? (
                    <option value="">加载 Agent 中...</option>
                  ) : uniqueAgents.length === 0 ? (
                    <option value="">
                      {isOverviewLoadFailed ? 'Agent 加载失败' : '无可用 Agent'}
                    </option>
                  ) : (
                    uniqueAgents.map((agent) => (
                      <option key={`${agent.instance_id}:${agent.agent_id}`} value={agent.agent_id}>
                        {agent.agent_name || agent.agent_id} ({agent.agent_id})
                      </option>
                    ))
                  )}
                </select>
                <div style={isMobile ? { ...plannerComposerHintStyle, ...plannerComposerHintMobileStyle } : plannerComposerHintStyle}>
                  <span>Enter 发送</span>
                  <span style={plannerComposerHintDividerStyle}>/</span>
                  <span>Shift+Enter 换行</span>
                </div>
              </div>
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={onSubmitOrStop}
                disabled={isPlannerStopActionActive ? isPlannerStopping : !canPromptPlanner || plannerInput.trim() === ''}
              >
                {isPlannerStopActionActive ? (isPlannerStopping ? '停止中...' : '停止') : '发送'}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
