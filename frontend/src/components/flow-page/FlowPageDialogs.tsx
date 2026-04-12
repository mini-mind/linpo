import type React from 'react';

import type { AggregateOverviewAgentItem } from '../../api/types';
import {
  actionRowStyle,
  actionRowMobileStyle,
  confirmOverlayStyle,
  confirmOverlayMobileStyle,
  confirmCardStyle,
  confirmCardMobileStyle,
  modalCardStyle,
  confirmTitleStyle,
  confirmTextStyle,
  confirmWarningTextStyle,
  secondaryButtonStyle,
  secondaryButtonMobileStyle,
  primaryButtonStyle,
  primaryButtonMobileStyle,
  flowDetailCardStyle,
  flowDetailCardMobileStyle,
  flowDetailTitleStyle,
  dangerButtonStyle,
  formFieldStyle,
  formLabelStyle,
  formInputStyle,
  formTextareaStyle,
  formReadonlyTextStyle,
  checkboxRowStyle,
} from '../flowPageStyles';

type NodeModalViewState = {
  open: boolean;
  mode: 'create' | 'edit';
  title: string;
  description: string;
  sensitive: boolean;
};

type LaneModalViewState = {
  open: boolean;
  mode: 'create' | 'edit';
  name: string;
  scopeKey: string;
};

type FlowPageDialogsProps = {
  isMobile: boolean;
  isCreateFlowModalOpen: boolean;
  createFlowNameInput: string;
  createFlowNamePlaceholder: string;
  onCreateFlowNameInputChange: (value: string) => void;
  onCloseCreateFlowModal: () => void;
  onConfirmCreateFlow: () => void;
  isDetailOpen: boolean;
  flowNameInput: string;
  onFlowNameInputChange: (value: string) => void;
  onCloseDetail: () => void;
  isSubmittingFlow: boolean;
  isFlowActioning: boolean;
  isPlanning: boolean;
  showDetailActionButton: boolean;
  detailActionButtonStyle: React.CSSProperties;
  detailActionDisabled: boolean;
  detailActionButtonLabel: string;
  onDetailAction: () => void;
  onDeleteCurrentFlow: () => void;
  onRenameFlow: () => void;
  isSubmitConfirmOpen: boolean;
  hasExistingFlowOutputs: boolean;
  onCloseSubmitConfirm: () => void;
  onConfirmRunFlow: () => void;
  nodeModal: NodeModalViewState;
  nodeModalLaneName: string;
  onCloseNodeModal: () => void;
  onNodeModalTitleChange: (value: string) => void;
  onNodeModalDescriptionChange: (value: string) => void;
  onNodeModalSensitiveChange: (checked: boolean) => void;
  onSaveNodeModal: () => void;
  laneModal: LaneModalViewState;
  laneAgentOptions: AggregateOverviewAgentItem[];
  onCloseLaneModal: () => void;
  onLaneModalNameChange: (value: string) => void;
  onLaneModalScopeKeyChange: (scopeKey: string) => void;
  onSaveLaneModal: () => void;
};

export function FlowPageDialogs(props: FlowPageDialogsProps): JSX.Element {
  const {
    isMobile,
    isCreateFlowModalOpen,
    createFlowNameInput,
    createFlowNamePlaceholder,
    onCreateFlowNameInputChange,
    onCloseCreateFlowModal,
    onConfirmCreateFlow,
    isDetailOpen,
    flowNameInput,
    onFlowNameInputChange,
    onCloseDetail,
    isSubmittingFlow,
    isFlowActioning,
    isPlanning,
    showDetailActionButton,
    detailActionButtonStyle,
    detailActionDisabled,
    detailActionButtonLabel,
    onDetailAction,
    onDeleteCurrentFlow,
    onRenameFlow,
    isSubmitConfirmOpen,
    hasExistingFlowOutputs,
    onCloseSubmitConfirm,
    onConfirmRunFlow,
    nodeModal,
    nodeModalLaneName,
    onCloseNodeModal,
    onNodeModalTitleChange,
    onNodeModalDescriptionChange,
    onNodeModalSensitiveChange,
    onSaveNodeModal,
    laneModal,
    laneAgentOptions,
    onCloseLaneModal,
    onLaneModalNameChange,
    onLaneModalScopeKeyChange,
    onSaveLaneModal,
  } = props;

  // 弹窗统一聚合为纯展示组件，避免 FlowPage 继续堆积大量 JSX。
  return (
    <>
      {isCreateFlowModalOpen ? (
        <div style={isMobile ? { ...confirmOverlayStyle, ...confirmOverlayMobileStyle } : confirmOverlayStyle} role="dialog" aria-modal="true" aria-label="新建流程">
          <div style={isMobile ? { ...modalCardStyle, ...confirmCardMobileStyle } : modalCardStyle}>
            <h3 style={confirmTitleStyle}>新建流程</h3>
            <label style={formFieldStyle}>
              <span style={formLabelStyle}>流程名称</span>
              <input
                value={createFlowNameInput}
                onChange={(event) => onCreateFlowNameInputChange(event.target.value)}
                style={formInputStyle}
                placeholder={createFlowNamePlaceholder}
                autoFocus
              />
            </label>
            <div style={isMobile ? { ...actionRowStyle, ...actionRowMobileStyle } : actionRowStyle}>
              <button
                type="button"
                style={isMobile ? { ...secondaryButtonStyle, ...secondaryButtonMobileStyle } : secondaryButtonStyle}
                onClick={onCloseCreateFlowModal}
              >
                取消
              </button>
              <button
                type="button"
                style={isMobile ? { ...primaryButtonStyle, ...primaryButtonMobileStyle } : primaryButtonStyle}
                onClick={onConfirmCreateFlow}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isDetailOpen ? (
        <div
          style={isMobile ? { ...confirmOverlayStyle, ...confirmOverlayMobileStyle } : confirmOverlayStyle}
          role="presentation"
          data-testid="flow-detail-overlay"
        >
          <div
            style={isMobile ? { ...flowDetailCardStyle, ...flowDetailCardMobileStyle } : flowDetailCardStyle}
            role="dialog"
            aria-modal="true"
            aria-label="流程编辑窗口"
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
              <h3 style={flowDetailTitleStyle}>流程编辑</h3>
              <button
                type="button"
                aria-label="关闭流程编辑窗口"
                onClick={onCloseDetail}
                disabled={isSubmittingFlow || isFlowActioning || isPlanning}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'rgba(229, 231, 235, 0.86)',
                  fontSize: '1.2rem',
                  lineHeight: 1,
                  cursor: 'pointer',
                  padding: '0.1rem 0.2rem',
                }}
              >
                ×
              </button>
            </div>
            <label style={formFieldStyle}>
              <span style={formLabelStyle}>流程名称</span>
              <input
                value={flowNameInput}
                onChange={(event) => onFlowNameInputChange(event.target.value)}
                style={formInputStyle}
                placeholder="输入流程名称"
                disabled={isSubmittingFlow || isFlowActioning || isPlanning}
              />
            </label>
            <div style={actionRowStyle}>
              {showDetailActionButton ? (
                <button
                  type="button"
                  style={detailActionButtonStyle}
                  onClick={onDetailAction}
                  disabled={detailActionDisabled}
                >
                  {detailActionButtonLabel}
                </button>
              ) : null}
              <button
                type="button"
                style={dangerButtonStyle}
                onClick={onDeleteCurrentFlow}
                disabled={isSubmittingFlow || isFlowActioning || isPlanning}
              >
                删除流程
              </button>
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={onRenameFlow}
                disabled={isSubmittingFlow || isFlowActioning || isPlanning}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isSubmitConfirmOpen ? (
        <div style={isMobile ? { ...confirmOverlayStyle, ...confirmOverlayMobileStyle } : confirmOverlayStyle} role="dialog" aria-modal="true" aria-label="确认运行流程">
          <div style={isMobile ? { ...confirmCardStyle, ...confirmCardMobileStyle } : confirmCardStyle}>
            <h3 style={confirmTitleStyle}>确认运行流程</h3>
            <p style={confirmTextStyle}>运行后将按当前画布把该流程加入看板队列并开始调度，确认继续？</p>
            {hasExistingFlowOutputs ? (
              <p style={confirmWarningTextStyle}>检测到该流程已有产出文件，再次运行可能覆盖历史产物。</p>
            ) : null}
            <div style={isMobile ? { ...actionRowStyle, ...actionRowMobileStyle } : actionRowStyle}>
              <button type="button" style={isMobile ? { ...secondaryButtonStyle, ...secondaryButtonMobileStyle } : secondaryButtonStyle} onClick={onCloseSubmitConfirm} disabled={isSubmittingFlow || isPlanning}>
                取消
              </button>
              <button type="button" style={isMobile ? { ...primaryButtonStyle, ...primaryButtonMobileStyle } : primaryButtonStyle} onClick={onConfirmRunFlow} disabled={isSubmittingFlow || isPlanning}>
                {isSubmittingFlow ? '运行中...' : '确认运行'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {nodeModal.open ? (
        <div style={isMobile ? { ...confirmOverlayStyle, ...confirmOverlayMobileStyle } : confirmOverlayStyle} role="dialog" aria-modal="true" aria-label={nodeModal.mode === 'create' ? '创建节点' : '编辑节点'}>
          <div style={isMobile ? { ...modalCardStyle, ...confirmCardMobileStyle } : modalCardStyle}>
            <h3 style={confirmTitleStyle}>{nodeModal.mode === 'create' ? '创建任务节点' : '编辑任务节点'}</h3>
            <label style={formFieldStyle}>
              <span style={formLabelStyle}>节点标题</span>
              <input
                value={nodeModal.title}
                onChange={(event) => onNodeModalTitleChange(event.target.value)}
                style={formInputStyle}
                placeholder="输入节点标题"
                autoFocus
              />
            </label>
            <label style={formFieldStyle}>
              <span style={formLabelStyle}>任务详细描述</span>
              <textarea
                value={nodeModal.description}
                onChange={(event) => onNodeModalDescriptionChange(event.target.value)}
                style={formTextareaStyle}
                placeholder="补充任务目标、输入输出、限制条件、验收标准等..."
              />
            </label>
            <label style={formFieldStyle}>
              <span style={formLabelStyle}>所属泳道</span>
              <span style={formReadonlyTextStyle}>{nodeModalLaneName || '未命名泳道'}</span>
            </label>
            <label style={checkboxRowStyle}>
              <input
                type="checkbox"
                checked={nodeModal.sensitive}
                onChange={(event) => onNodeModalSensitiveChange(event.target.checked)}
              />
              <span style={formLabelStyle}>敏感节点（完成后进入审批）</span>
            </label>
            <div style={isMobile ? { ...actionRowStyle, ...actionRowMobileStyle } : actionRowStyle}>
              <button type="button" style={isMobile ? { ...secondaryButtonStyle, ...secondaryButtonMobileStyle } : secondaryButtonStyle} onClick={onCloseNodeModal}>
                取消
              </button>
              <button type="button" style={isMobile ? { ...primaryButtonStyle, ...primaryButtonMobileStyle } : primaryButtonStyle} onClick={onSaveNodeModal}>
                保存节点
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {laneModal.open ? (
        <div style={isMobile ? { ...confirmOverlayStyle, ...confirmOverlayMobileStyle } : confirmOverlayStyle} role="dialog" aria-modal="true" aria-label={laneModal.mode === 'create' ? '创建泳道' : '编辑泳道'}>
          <div style={isMobile ? { ...modalCardStyle, ...confirmCardMobileStyle } : modalCardStyle}>
            <h3 style={confirmTitleStyle}>{laneModal.mode === 'create' ? '创建泳道' : '编辑泳道'}</h3>
            <label style={formFieldStyle}>
              <span style={formLabelStyle}>泳道名称</span>
              <input
                value={laneModal.name}
                onChange={(event) => onLaneModalNameChange(event.target.value)}
                style={formInputStyle}
                placeholder="输入泳道名称"
                autoFocus
              />
            </label>
            <label style={formFieldStyle}>
              <span style={formLabelStyle}>委派实例 / Agent</span>
              <select
                value={laneModal.scopeKey}
                onChange={(event) => onLaneModalScopeKeyChange(event.target.value)}
                style={formInputStyle}
              >
                <option value="">未委派</option>
                {laneAgentOptions.map((agent) => (
                  <option
                    key={`${agent.instance_id}::${agent.agent_id}`}
                    value={`${agent.instance_id}::${agent.agent_id}`}
                  >
                    {agent.instance_id} / {agent.agent_name || agent.agent_id} ({agent.agent_id})
                  </option>
                ))}
              </select>
            </label>
            <div style={isMobile ? { ...actionRowStyle, ...actionRowMobileStyle } : actionRowStyle}>
              <button type="button" style={isMobile ? { ...secondaryButtonStyle, ...secondaryButtonMobileStyle } : secondaryButtonStyle} onClick={onCloseLaneModal}>
                取消
              </button>
              <button type="button" style={isMobile ? { ...primaryButtonStyle, ...primaryButtonMobileStyle } : primaryButtonStyle} onClick={onSaveLaneModal}>
                保存泳道
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
