import type React from 'react';
import type { InstanceAgentDocItem, InstanceFileItem, TaskOutputPreviewResponse } from '../../api/types';
import { MarkdownMessage } from '../MarkdownMessage';
import {
  actionButtonStyle,
  actionDangerButtonStyle,
  actionLinkStyle,
  actionPrimaryButtonStyle,
  agentDocSourceBadgeStyle,
  desktopPreviewBodyStyle,
  desktopPreviewContentShellStyle,
  desktopPreviewPanelStyle,
  editorTextareaStyle,
  errorTextStyle,
  hintTextStyle,
  imageStyle,
  jsonStyle,
  loadingPlaceholderPanelStyle,
  loadingPlaceholderSubtextStyle,
  metaGridMobileStyle,
  metaGridStyle,
  metaItemMobileStyle,
  metaItemStyle,
  previewActionRowStyle,
  previewBodyStyle,
  previewContentShellStyle,
  previewHeaderCopyStyle,
  previewHeaderStyle,
  previewPanelStyle,
  previewSubtitleStyle,
  previewTitleRowStyle,
  previewTitleStyle,
  taskSourceBadgeStyle,
  textStyle,
} from './styles';
import { formatDateTime, formatSize, getRequirementLabel, safePrettyJson } from './utils';

export function InstanceFilesPreviewPanel({
  isMobile,
  loadError,
  isLoading,
  selectedResource,
  selectedTaskFile,
  selectedAgentDoc,
  currentInstanceName,
  isAgentDocMarkdown,
  isAgentDocReadonly,
  isPreviewLoading,
  previewError,
  preview,
  isEditingTaskFile,
  editorContent,
  onEditorContentChange,
  canStartEdit,
  canDeleteTask,
  isSavingTaskFile,
  isDeletingTaskFile,
  onStartEditTaskFile,
  onCancelEditTaskFile,
  onSaveTaskFile,
  onDeleteTaskFile,
  downloadUrl,
  inlineUrl,
}: {
  isMobile: boolean;
  loadError: string | null;
  isLoading: boolean;
  selectedResource: { kind: 'task' | 'agent-doc'; id: string } | null;
  selectedTaskFile: InstanceFileItem | null;
  selectedAgentDoc: InstanceAgentDocItem | null;
  currentInstanceName: string;
  isAgentDocMarkdown: boolean;
  isAgentDocReadonly: boolean;
  isPreviewLoading: boolean;
  previewError: string | null;
  preview: TaskOutputPreviewResponse | null;
  isEditingTaskFile: boolean;
  editorContent: string;
  onEditorContentChange: (value: string) => void;
  canStartEdit: boolean;
  canDeleteTask: boolean;
  isSavingTaskFile: boolean;
  isDeletingTaskFile: boolean;
  onStartEditTaskFile: () => void;
  onCancelEditTaskFile: () => void;
  onSaveTaskFile: () => void;
  onDeleteTaskFile: () => void;
  downloadUrl: string;
  inlineUrl: string;
}): JSX.Element {
  const isPreviewShellLoading = !loadError && isLoading && !selectedResource && !selectedTaskFile && !selectedAgentDoc;

  return (
    <article style={isMobile ? previewPanelStyle : desktopPreviewPanelStyle} data-testid="instance-files-main">
      {/* 始终渲染相同的预览骨架，避免首屏空态与加载后结构不同导致高度抖动。 */}
      <div style={previewHeaderStyle}>
        <div style={previewHeaderCopyStyle}>
          <div style={previewTitleRowStyle}>
            <h3 style={previewTitleStyle}>{selectedTaskFile?.name ?? selectedAgentDoc?.name ?? '-'}</h3>
            <span style={selectedTaskFile ? taskSourceBadgeStyle : agentDocSourceBadgeStyle}>
              {selectedTaskFile ? '流程产物' : selectedAgentDoc ? 'Agent 文档' : isPreviewShellLoading ? '加载中' : '未选择'}
            </span>
          </div>
          <p style={previewSubtitleStyle}>
            {isPreviewShellLoading
              ? '正在同步文件与文档信息...'
              : selectedTaskFile
              ? `流程 ${getRequirementLabel(selectedTaskFile)} · 节点 ${selectedTaskFile.task_title}`
              : `Agent ${selectedAgentDoc?.agent_name || selectedAgentDoc?.agent_id || '-'}`}
          </p>
        </div>
        <div style={previewActionRowStyle}>
          <button
            type="button"
            style={actionButtonStyle}
            onClick={onStartEditTaskFile}
            disabled={!canStartEdit}
          >
            编辑
          </button>
          {isEditingTaskFile ? (
            <>
              <button
                type="button"
                style={actionButtonStyle}
                onClick={onCancelEditTaskFile}
                disabled={isSavingTaskFile}
              >
                取消
              </button>
              <button
                type="button"
                style={actionPrimaryButtonStyle}
                onClick={onSaveTaskFile}
                disabled={isSavingTaskFile}
              >
                {isSavingTaskFile ? '保存中...' : '保存'}
              </button>
            </>
          ) : null}
          <button
            type="button"
            style={actionDangerButtonStyle}
            onClick={onDeleteTaskFile}
            disabled={!canDeleteTask}
          >
            {isDeletingTaskFile ? '删除中...' : '删除'}
          </button>
          <a href={downloadUrl} style={actionLinkStyle}>
            下载
          </a>
        </div>
      </div>
      <div style={isMobile ? { ...metaGridStyle, ...metaGridMobileStyle } : metaGridStyle}>
        <span style={isMobile ? { ...metaItemStyle, ...metaItemMobileStyle } : metaItemStyle}>
          实例：{currentInstanceName || '-'}
        </span>
        <span style={isMobile ? { ...metaItemStyle, ...metaItemMobileStyle } : metaItemStyle}>
          类型：{selectedTaskFile ? '产出' : '配置'}
        </span>
        <span style={isMobile ? { ...metaItemStyle, ...metaItemMobileStyle } : metaItemStyle}>
          状态：{selectedTaskFile?.exists ?? selectedAgentDoc?.exists ? '可访问' : '缺失'}
        </span>
        <span style={isMobile ? { ...metaItemStyle, ...metaItemMobileStyle } : metaItemStyle}>
          路径：{selectedTaskFile?.path ?? selectedAgentDoc?.path ?? '-'}
        </span>
        <span style={isMobile ? { ...metaItemStyle, ...metaItemMobileStyle } : metaItemStyle}>
          大小：{formatSize(selectedTaskFile?.size_bytes ?? selectedAgentDoc?.size_bytes ?? null)}
        </span>
        <span style={isMobile ? { ...metaItemStyle, ...metaItemMobileStyle } : metaItemStyle}>
          更新时间：{formatDateTime(selectedTaskFile?.updated_at ?? selectedAgentDoc?.updated_at ?? '-')}
        </span>
        {selectedTaskFile ? (
          <>
            <span style={isMobile ? { ...metaItemStyle, ...metaItemMobileStyle } : metaItemStyle}>
              流程：{getRequirementLabel(selectedTaskFile)}
            </span>
            <span style={isMobile ? { ...metaItemStyle, ...metaItemMobileStyle } : metaItemStyle}>
              节点：{selectedTaskFile.task_title}
            </span>
            <span style={isMobile ? { ...metaItemStyle, ...metaItemMobileStyle } : metaItemStyle}>
              Agent：{selectedTaskFile.agent_name || selectedTaskFile.agent_id}
            </span>
          </>
        ) : null}
        {selectedAgentDoc ? (
          <span style={isMobile ? { ...metaItemStyle, ...metaItemMobileStyle } : metaItemStyle}>
            Agent：{selectedAgentDoc.agent_name || selectedAgentDoc.agent_id}
          </span>
        ) : null}
        {selectedAgentDoc ? (
          <span style={isMobile ? { ...metaItemStyle, ...metaItemMobileStyle } : metaItemStyle}>
            文档权限：{isAgentDocMarkdown ? '只读（MD 锁定）' : '只读'}
          </span>
        ) : null}
      </div>
      <div style={isMobile ? previewBodyStyle : desktopPreviewBodyStyle}>
        <div
          style={isMobile ? previewContentShellStyle : desktopPreviewContentShellStyle}
          data-testid="instance-files-preview-content"
        >
          {isPreviewShellLoading ? (
            <div style={loadingPlaceholderPanelStyle}>
              <p style={hintTextStyle}>文件信息加载中...</p>
              <p style={loadingPlaceholderSubtextStyle}>加载完成后将自动展示可选文件与预览内容。</p>
            </div>
          ) : null}
          {!isPreviewShellLoading && (!selectedResource || (!selectedTaskFile && !selectedAgentDoc)) ? (
            <p style={hintTextStyle}>选择文件后查看预览</p>
          ) : null}
          {isPreviewLoading ? <p style={hintTextStyle}>加载预览...</p> : null}
          {previewError ? <p style={errorTextStyle}>{previewError}</p> : null}
          {selectedTaskFile && isEditingTaskFile ? (
            <textarea
              value={editorContent}
              onChange={(event) => onEditorContentChange(event.target.value)}
              placeholder="输入文件内容"
              style={editorTextareaStyle}
              aria-label="文件编辑器"
              readOnly={isAgentDocReadonly}
            />
          ) : null}
          {!isEditingTaskFile && !isPreviewLoading && !previewError && preview ? (
            preview.kind === 'json' ? (
              <pre style={jsonStyle}>{safePrettyJson(preview.content)}</pre>
            ) : preview.kind === 'text' ? (
              <MarkdownMessage text={preview.content ?? ''} style={textStyle} />
            ) : preview.mime_type.startsWith('image/') ? (
              <img
                src={inlineUrl}
                alt={selectedTaskFile?.name ?? selectedAgentDoc?.name ?? 'preview'}
                style={imageStyle}
              />
            ) : (
              <p style={hintTextStyle}>该文件为二进制格式，暂不支持内嵌预览，请下载查看。</p>
            )
          ) : null}
          {!isEditingTaskFile && !isPreviewLoading && !previewError && !preview && selectedTaskFile && !selectedTaskFile.exists ? (
            <p style={hintTextStyle}>文件不存在，可点击“编辑”写入内容。</p>
          ) : null}
        </div>
      </div>
    </article>
  );
}
