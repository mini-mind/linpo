import type React from 'react';
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
import type { SelectedResource } from './types';

type PreviewTask = {
  id: string;
  name: string;
  path: string;
  exists: boolean;
  task_title: string;
  task_id: string;
  agent_id: string;
  agent_name: string;
  requirement_id: string;
  requirement_title: string;
  updated_at: string;
  size_bytes: number;
};

type PreviewAgentDoc = {
  id: string;
  name: string;
  path: string;
  exists: boolean;
  agent_id: string;
  agent_name: string;
  updated_at: string;
  size_bytes: number;
};

type PreviewPayload = {
  kind: 'json' | 'text' | string;
  content: string | null;
  mime_type: string;
};

type InstanceFilesPreviewProps = {
  isMobile: boolean;
  loadError: string | null;
  isLoading: boolean;
  selectedResource: SelectedResource | null;
  selectedTaskFile: PreviewTask | null;
  selectedAgentDoc: PreviewAgentDoc | null;
  isPreviewLoading: boolean;
  previewError: string | null;
  preview: PreviewPayload | null;
  isEditingTaskFile: boolean;
  editorContent: string;
  onEditorContentChange: (value: string) => void;
  isSavingTaskFile: boolean;
  isDeletingTaskFile: boolean;
  canStartEdit: boolean;
  canDeleteTask: boolean;
  onStartEditTaskFile: () => void;
  onCancelEditTaskFile: () => void;
  onSaveTaskFile: () => Promise<void>;
  onDeleteTaskFile: () => Promise<void>;
  downloadUrl: string;
  inlineUrl: string;
  currentInstanceName: string | null;
  getRequirementLabel: (task: PreviewTask) => string;
  formatSize: (sizeBytes: number | null) => string;
  formatDateTime: (value: string) => string;
  safePrettyJson: (value: string | null) => string;
  isAgentDocMarkdown: boolean;
};

export function InstanceFilesPreview({
  isMobile,
  loadError,
  isLoading,
  selectedResource,
  selectedTaskFile,
  selectedAgentDoc,
  isPreviewLoading,
  previewError,
  preview,
  isEditingTaskFile,
  editorContent,
  onEditorContentChange,
  isSavingTaskFile,
  isDeletingTaskFile,
  canStartEdit,
  canDeleteTask,
  onStartEditTaskFile,
  onCancelEditTaskFile,
  onSaveTaskFile,
  onDeleteTaskFile,
  downloadUrl,
  inlineUrl,
  currentInstanceName,
  getRequirementLabel,
  formatSize,
  formatDateTime,
  safePrettyJson,
  isAgentDocMarkdown,
}: InstanceFilesPreviewProps): JSX.Element {
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
          <button type="button" style={actionButtonStyle} onClick={onStartEditTaskFile} disabled={!canStartEdit}>
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
                onClick={() => {
                  void onSaveTaskFile();
                }}
                disabled={isSavingTaskFile}
              >
                {isSavingTaskFile ? '保存中...' : '保存'}
              </button>
            </>
          ) : null}
          <button
            type="button"
            style={actionDangerButtonStyle}
            onClick={() => {
              void onDeleteTaskFile();
            }}
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
          实例：{currentInstanceName ?? '-'}
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
          {!isEditingTaskFile &&
          !isPreviewLoading &&
          !previewError &&
          !preview &&
          selectedTaskFile &&
          !selectedTaskFile.exists ? (
            <p style={hintTextStyle}>文件不存在，可点击“编辑”写入内容。</p>
          ) : null}
        </div>
      </div>
    </article>
  );
}
