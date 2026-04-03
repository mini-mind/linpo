import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Braces, File, FileArchive, FileCode2, FileJson, FileText, Folder, Image, Music4, Video } from 'lucide-react';
import {
  buildInstanceAgentDocDownloadUrl,
  buildInstanceFileDownloadUrl,
  listInstanceAgentDocs,
  listInstanceFiles,
  listInstances,
  previewInstanceAgentDoc,
  previewInstanceFile,
} from '../api/instanceClient';
import type {
  InstanceAgentDocItem,
  InstanceFileItem,
  InstanceItem,
  TaskOutputPreviewResponse,
} from '../api/types';
import { useCurrentInstanceId } from '../hooks/useCurrentInstance';
import { useDraggableFab } from '../hooks/useDraggableFab';
import { useIsMobile } from '../hooks/useIsMobile';
import { useToast } from '../hooks/useToast';
import { MarkdownMessage } from './MarkdownMessage';
import {
  getWorkspaceBodyInnerStyle,
  getWorkspaceBodyShellStyle,
  getWorkspacePageStyle,
  WORKSPACE_CONTENT_MAX_WIDTH_PX,
} from './workspaceLayout';

const DEFAULT_BOARD_ID = 'default';
const INSTANCE_FILES_SIDEBAR_WIDTH_PX = 320;
const INSTANCE_FILES_SIDEBAR_MIN_WIDTH_PX = 240;
const INSTANCE_FILES_SIDEBAR_MAX_WIDTH_PX = 560;
const INSTANCE_FILES_SIDEBAR_RESIZER_WIDTH_PX = 10;
const INSTANCE_FILES_PREVIEW_CONTENT_MAX_WIDTH_PX = 960;
const WORKSPACE_ROOT_PATH = '/home/node/.openclaw/workspace/';

type SelectedResource =
  | { kind: 'task'; id: string }
  | { kind: 'agent-doc'; id: string };

type SidebarResourceItem =
  | {
      kind: 'task';
      id: string;
      title: string;
      path: string;
      exists: boolean;
      updatedAt: string;
      iconKind: FileIconKind;
      ariaLabel: string;
    }
  | {
      kind: 'agent-doc';
      id: string;
      title: string;
      path: string;
      exists: boolean;
      updatedAt: string;
      iconKind: FileIconKind;
      ariaLabel: string;
    };

type FileIconKind = 'folder' | 'markdown' | 'json' | 'image' | 'audio' | 'video' | 'pdf' | 'archive' | 'code' | 'text';

type PathTreeNode = {
  id: string;
  name: string;
  resource: SidebarResourceItem | null;
  children: PathTreeNode[];
};

export function InstanceFilesPage(): JSX.Element {
  const isMobile = useIsMobile(960);
  const { addToast } = useToast();
  const [currentInstanceId, setCurrentInstanceId] = useCurrentInstanceId();
  const [instances, setInstances] = useState<InstanceItem[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState('');
  const [taskItems, setTaskItems] = useState<InstanceFileItem[]>([]);
  const [agentDocs, setAgentDocs] = useState<InstanceAgentDocItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [selectedResource, setSelectedResource] = useState<SelectedResource | null>(null);
  const [preview, setPreview] = useState<TaskOutputPreviewResponse | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [desktopSidebarWidth, setDesktopSidebarWidth] = useState(INSTANCE_FILES_SIDEBAR_WIDTH_PX);
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const sidebarResizeStateRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const filesFab = useDraggableFab('linpo.mobile_fab.instance_files_sidebar', { x: 16, y: 88 });

  const selectedInstance = useMemo(
    () => instances.find((item) => item.id === selectedInstanceId) ?? null,
    [instances, selectedInstanceId]
  );
  const selectedTaskFile = useMemo(
    () =>
      selectedResource?.kind === 'task'
        ? taskItems.find((item) => item.id === selectedResource.id) ?? null
        : null,
    [selectedResource, taskItems]
  );
  const selectedAgentDoc = useMemo(
    () =>
      selectedResource?.kind === 'agent-doc'
        ? agentDocs.find((item) => item.id === selectedResource.id) ?? null
        : null,
    [agentDocs, selectedResource]
  );

  const loadInstancesData = useCallback(async () => {
    try {
      const data = await listInstances();
      setInstances(data);
      setSelectedInstanceId((current) => {
        const fromCurrent = current.trim();
        if (fromCurrent && data.some((item) => item.id === fromCurrent)) {
          return fromCurrent;
        }
        const preferred = currentInstanceId ?? '';
        if (preferred && data.some((item) => item.id === preferred)) {
          return preferred;
        }
        return data[0]?.id ?? '';
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取实例失败';
      addToast(message, 'error');
    }
  }, [addToast, currentInstanceId]);

  const loadFiles = useCallback(async () => {
    const instanceId = selectedInstanceId.trim();
    if (!instanceId) {
      setTaskItems([]);
      setAgentDocs([]);
      setLoadError(null);
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    try {
      const [fileResponse, docResponse] = await Promise.all([
        listInstanceFiles(instanceId, {
          boardId: DEFAULT_BOARD_ID,
          q: keyword,
        }),
        listInstanceAgentDocs(instanceId, {
          q: keyword,
        }),
      ]);
      setTaskItems(fileResponse.items);
      setAgentDocs(docResponse.items);
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取实例文件失败';
      setLoadError(message);
    } finally {
      setIsLoading(false);
    }
  }, [keyword, selectedInstanceId]);

  useEffect(() => {
    void loadInstancesData();
  }, [loadInstancesData]);

  useEffect(() => {
    if (!selectedInstanceId.trim()) {
      return;
    }
    setCurrentInstanceId(selectedInstanceId);
  }, [selectedInstanceId, setCurrentInstanceId]);

  useEffect(() => {
    if (!selectedInstanceId.trim()) {
      return;
    }
    const timer = window.setTimeout(() => {
      void loadFiles();
    }, 220);
    return () => {
      window.clearTimeout(timer);
    };
  }, [loadFiles, selectedInstanceId]);

  useEffect(() => {
    const instanceId = selectedInstanceId.trim();
    if (!instanceId || !selectedResource) {
      setPreview(null);
      setPreviewError(null);
      setIsPreviewLoading(false);
      return;
    }

    let cancelled = false;
    setIsPreviewLoading(true);
    setPreviewError(null);
    const previewPromise =
      selectedResource.kind === 'task' && selectedTaskFile
        ? previewInstanceFile(instanceId, selectedTaskFile.task_id, selectedTaskFile.path, {
            boardId: DEFAULT_BOARD_ID,
          })
        : selectedResource.kind === 'agent-doc' && selectedAgentDoc
          ? previewInstanceAgentDoc(instanceId, selectedAgentDoc.agent_id, selectedAgentDoc.name)
          : null;

    if (!previewPromise) {
      setPreview(null);
      setIsPreviewLoading(false);
      return;
    }

    void previewPromise
      .then((payload) => {
        if (!cancelled) {
          setPreview(payload);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : '读取文件预览失败';
        setPreviewError(message);
        setPreview(null);
      })
      .finally(() => {
        if (!cancelled) {
          setIsPreviewLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedAgentDoc, selectedInstanceId, selectedResource, selectedTaskFile]);

  const inlineUrl = useMemo(() => {
    if (!selectedInstanceId.trim()) {
      return '';
    }
    if (selectedResource?.kind === 'task' && selectedTaskFile) {
      return buildInstanceFileDownloadUrl(selectedInstanceId, selectedTaskFile.task_id, selectedTaskFile.path, {
        boardId: DEFAULT_BOARD_ID,
        download: false,
      });
    }
    if (selectedResource?.kind === 'agent-doc' && selectedAgentDoc) {
      return buildInstanceAgentDocDownloadUrl(selectedInstanceId, selectedAgentDoc.agent_id, selectedAgentDoc.name, {
        download: false,
      });
    }
    return '';
  }, [selectedAgentDoc, selectedInstanceId, selectedResource, selectedTaskFile]);

  const downloadUrl = useMemo(() => {
    if (!selectedInstanceId.trim()) {
      return '';
    }
    if (selectedResource?.kind === 'task' && selectedTaskFile) {
      return buildInstanceFileDownloadUrl(selectedInstanceId, selectedTaskFile.task_id, selectedTaskFile.path, {
        boardId: DEFAULT_BOARD_ID,
        download: true,
      });
    }
    if (selectedResource?.kind === 'agent-doc' && selectedAgentDoc) {
      return buildInstanceAgentDocDownloadUrl(selectedInstanceId, selectedAgentDoc.agent_id, selectedAgentDoc.name, {
        download: true,
      });
    }
    return '';
  }, [selectedAgentDoc, selectedInstanceId, selectedResource, selectedTaskFile]);

  const resourceItems = useMemo(() => {
    const merged: SidebarResourceItem[] = [];
    for (const item of taskItems) {
      merged.push({
        kind: 'task',
        id: item.id,
        title: item.name,
        path: item.path,
        exists: item.exists,
        updatedAt: item.updated_at,
        iconKind: resolveFileIconKind(item.path, item.name),
        ariaLabel: `查看任务文件 ${item.name}`,
      });
    }
    for (const doc of agentDocs) {
      merged.push({
        kind: 'agent-doc',
        id: doc.id,
        title: doc.name,
        path: doc.path,
        exists: doc.exists,
        updatedAt: doc.updated_at,
        iconKind: resolveFileIconKind(doc.path, doc.name),
        ariaLabel: `查看 Agent 文档 ${doc.name}`,
      });
    }
    return merged.sort((left, right) => {
      const timeDiff = compareTimestamps(right.updatedAt, left.updatedAt);
      if (timeDiff !== 0) {
        return timeDiff;
      }
      return left.path.localeCompare(right.path, 'zh-CN');
    });
  }, [agentDocs, taskItems]);

  const pathTree = useMemo(
    () => buildPathTree(resourceItems, selectedInstance?.name ?? ''),
    [resourceItems, selectedInstance?.name]
  );

  useEffect(() => {
    const resourceStillExists =
      selectedResource &&
      resourceItems.some((item) => item.kind === selectedResource.kind && item.id === selectedResource.id);
    if (resourceStillExists) {
      return;
    }
    const fallback = resourceItems[0];
    if (fallback) {
      setSelectedResource({ kind: fallback.kind, id: fallback.id });
      return;
    }
    setSelectedResource(null);
  }, [resourceItems, selectedResource]);

  useEffect(() => {
    if (isMobile) {
      setIsSidebarResizing(false);
      sidebarResizeStateRef.current = null;
      return;
    }
    setIsMobileSidebarOpen(false);
  }, [isMobile]);

  useEffect(() => {
    if (!isSidebarResizing) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = sidebarResizeStateRef.current;
      if (!resizeState || resizeState.pointerId !== event.pointerId) {
        return;
      }
      const deltaX = event.clientX - resizeState.startX;
      const nextWidth = clampSidebarWidth(resizeState.startWidth + deltaX);
      setDesktopSidebarWidth(nextWidth);
    };

    const finishResize = (event: PointerEvent) => {
      const resizeState = sidebarResizeStateRef.current;
      if (!resizeState || resizeState.pointerId !== event.pointerId) {
        return;
      }
      sidebarResizeStateRef.current = null;
      setIsSidebarResizing(false);
    };

    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', finishResize);
    window.addEventListener('pointercancel', finishResize);
    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishResize);
      window.removeEventListener('pointercancel', finishResize);
    };
  }, [isSidebarResizing]);

  const handleSidebarResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isMobile) {
        return;
      }
      event.preventDefault();
      sidebarResizeStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: desktopSidebarWidth,
      };
      setIsSidebarResizing(true);
    },
    [desktopSidebarWidth, isMobile]
  );

  const sidebarNode = (
    <aside
      style={isMobile ? listPanelStyle : desktopSidebarStyle}
      data-testid="instance-files-sidebar"
      aria-label="实例文件侧栏"
    >
      <section style={sidebarHeaderStyle}>
        <div style={isMobile ? { ...sidebarControlRowStyle, ...sidebarControlRowMobileStyle } : sidebarControlRowStyle}>
          <select
            value={selectedInstanceId}
            onChange={(event) => setSelectedInstanceId(event.target.value)}
            style={isMobile ? { ...controlStyle, ...controlMobileStyle } : controlStyle}
            aria-label="选择实例"
          >
            {instances.length === 0 ? <option value="">暂无实例</option> : null}
            {instances.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            style={isMobile ? { ...buttonStyle, ...buttonMobileStyle } : buttonStyle}
            onClick={() => void loadFiles()}
            disabled={isLoading}
          >
            {isLoading ? '刷新中...' : '刷新'}
          </button>
        </div>
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="搜索路径/任务/文档"
          style={isMobile ? { ...searchInputStyle, ...searchInputMobileStyle } : searchInputStyle}
          aria-label="搜索实例文件"
        />
      </section>

      {loadError ? <p style={errorTextStyle}>{loadError}</p> : null}
      {!loadError && isLoading ? <p style={hintTextStyle}>加载中...</p> : null}

      <section style={treeSectionStyle}>
        <div style={treeHeaderStyle}>
          <span style={panelTitleStyle}>文件树</span>
        </div>
        {!loadError && !isLoading && pathTree.length === 0 ? <p style={hintTextStyle}>暂无文件</p> : null}
        <div style={treeWrapStyle} data-testid="instance-files-tree">
          {pathTree.map((node) => renderTreeNode(node, 0, selectedResource, setSelectedResource))}
        </div>
      </section>
    </aside>
  );

  const previewNode = (
    <article style={isMobile ? previewPanelStyle : desktopPreviewPanelStyle} data-testid="instance-files-main">
      {!selectedResource || (!selectedTaskFile && !selectedAgentDoc) ? (
        <p style={hintTextStyle}>选择文件后查看预览</p>
      ) : (
        <>
          <div style={previewHeaderStyle}>
            <div style={previewHeaderCopyStyle}>
              <div style={previewTitleRowStyle}>
                <h3 style={previewTitleStyle}>{selectedTaskFile?.name ?? selectedAgentDoc?.name ?? '-'}</h3>
                <span style={selectedTaskFile ? taskSourceBadgeStyle : agentDocSourceBadgeStyle}>
                  {selectedTaskFile ? '流程产物' : 'Agent 文档'}
                </span>
              </div>
              <p style={previewSubtitleStyle}>
                {selectedTaskFile
                  ? `流程 ${getRequirementLabel(selectedTaskFile)} · 节点 ${selectedTaskFile.task_title}`
                  : `Agent ${selectedAgentDoc?.agent_name || selectedAgentDoc?.agent_id || '-'}`}
              </p>
            </div>
            <div style={previewActionRowStyle}>
              <a href={downloadUrl} style={actionLinkStyle}>
                下载
              </a>
            </div>
          </div>
          <div style={isMobile ? { ...metaGridStyle, ...metaGridMobileStyle } : metaGridStyle}>
            <span style={isMobile ? { ...metaItemStyle, ...metaItemMobileStyle } : metaItemStyle}>
              实例：{selectedInstance?.name ?? '-'}
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
          </div>
          <div style={isMobile ? previewBodyStyle : desktopPreviewBodyStyle}>
            <div style={previewContentShellStyle} data-testid="instance-files-preview-content">
              {isPreviewLoading ? <p style={hintTextStyle}>加载预览...</p> : null}
              {previewError ? <p style={errorTextStyle}>{previewError}</p> : null}
              {!isPreviewLoading && !previewError && preview ? (
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
            </div>
          </div>
        </>
      )}
    </article>
  );

  if (isMobile) {
    return (
      <section style={getWorkspacePageStyle()} aria-label="instance-files-page">
        <button
          type="button"
          style={{ ...mobileFabButtonStyle, left: `${filesFab.position.x}px`, top: `${filesFab.position.y}px`, touchAction: 'none' }}
          aria-label="打开文件侧栏"
          onPointerDown={filesFab.handlePointerDown}
          onClick={(event) => {
            if (!filesFab.consumeClickIfDragged(event)) {
              return;
            }
            setIsMobileSidebarOpen(true);
          }}
        >
          文件侧栏
        </button>
        {isMobileSidebarOpen ? (
          <div
            style={mobileSidebarDrawerOverlayStyle}
            role="dialog"
            aria-modal="true"
            aria-label="文件侧栏抽屉"
            onClick={() => setIsMobileSidebarOpen(false)}
          >
            <div
              style={mobileSidebarDrawerPanelStyle}
              onClick={(event) => event.stopPropagation()}
            >
              <div style={mobileSidebarDrawerHeaderStyle}>
                <h3 style={mobileSidebarDrawerTitleStyle}>文件侧栏</h3>
                <button
                  type="button"
                  style={mobileSidebarDrawerCloseStyle}
                  onClick={() => setIsMobileSidebarOpen(false)}
                >
                  关闭
                </button>
              </div>
              {sidebarNode}
            </div>
          </div>
        ) : null}
        <div style={getWorkspaceBodyShellStyle({ isMobile, extra: bodyShellMobileStyle })}>
          <div
            style={getWorkspaceBodyInnerStyle({
              isMobile,
              maxWidthPx: WORKSPACE_CONTENT_MAX_WIDTH_PX,
              extra: {
                ...getBodyStyle(true),
                gridTemplateRows: 'minmax(0, 1fr)',
              },
            })}
            data-testid="instance-files-content-frame"
          >
            {previewNode}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section style={getWorkspacePageStyle()} aria-label="instance-files-page">
      <div style={getDesktopShellStyle(desktopSidebarWidth)} data-testid="instance-files-shell">
        {sidebarNode}
        <div
          role="separator"
          aria-label="调整侧栏宽度"
          aria-orientation="vertical"
          data-testid="instance-files-sidebar-resizer"
          onPointerDown={handleSidebarResizePointerDown}
          style={isSidebarResizing ? { ...sidebarResizeHandleStyle, ...sidebarResizeHandleActiveStyle } : sidebarResizeHandleStyle}
        />
        {previewNode}
      </div>
    </section>
  );
}

function safePrettyJson(value: string | null): string {
  if (!value) return '';
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function formatSize(sizeBytes: number | null): string {
  if (sizeBytes === null || sizeBytes < 0) return '-';
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getRequirementLabel(item: InstanceFileItem): string {
  return item.requirement_title?.trim() || item.requirement_id?.trim() || '未命名流程';
}

function compareTimestamps(left: string, right: string): number {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  return (Number.isFinite(leftMs) ? leftMs : 0) - (Number.isFinite(rightMs) ? rightMs : 0);
}

function formatDateTime(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }
  return new Date(parsed).toLocaleString('zh-CN', { hour12: false });
}

function toPathSegments(path: string, fallbackName: string): string[] {
  const normalized = path.replace(/\\/g, '/').trim();
  if (!normalized) {
    return [fallbackName];
  }
  const genericSegments = normalized.split('/').filter((item) => item.trim() !== '');
  return genericSegments.length > 0 ? genericSegments : [fallbackName];
}

function normalizePathForWorkspaceTree(resource: SidebarResourceItem): string {
  const normalized = resource.path.replace(/\\/g, '/').trim();
  if (!normalized) {
    return resource.title;
  }
  if (normalized.startsWith('agent://')) {
    const tail = normalized.slice('agent://'.length).replace(/^\/+/, '');
    return tail ? `agents/${tail}` : `agents/${resource.title}`;
  }
  if (normalized.startsWith(WORKSPACE_ROOT_PATH)) {
    return normalized.slice(WORKSPACE_ROOT_PATH.length);
  }
  if (normalized.startsWith('/')) {
    return normalized.replace(/^\/+/, '');
  }
  return normalized;
}

function resolveFileIconKind(path: string, title: string): FileIconKind {
  const normalized = path.replace(/\\/g, '/').toLowerCase();
  const pathSegments = normalized.split('/').filter(Boolean);
  const leaf = (pathSegments[pathSegments.length - 1] ?? title).toLowerCase();
  const leafSegments = leaf.split('.');
  const extension = leaf.includes('.') ? leafSegments[leafSegments.length - 1] ?? '' : '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(extension)) return 'image';
  if (['mp3', 'wav', 'flac', 'ogg', 'm4a'].includes(extension)) return 'audio';
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(extension)) return 'video';
  if (extension === 'pdf') return 'pdf';
  if (['zip', 'tar', 'gz', 'tgz', '7z', 'rar'].includes(extension)) return 'archive';
  if (['md', 'markdown'].includes(extension)) return 'markdown';
  if (extension === 'json') return 'json';
  if (
    [
      'ts',
      'tsx',
      'js',
      'jsx',
      'py',
      'go',
      'rs',
      'java',
      'rb',
      'php',
      'sh',
      'yaml',
      'yml',
      'toml',
      'ini',
      'conf',
      'env',
      'sql',
      'xml',
      'html',
      'css',
    ].includes(extension)
  ) {
    return 'code';
  }
  return 'text';
}

function FileTypeIcon({ kind }: { kind: FileIconKind }): JSX.Element {
  const commonProps = {
    size: 14,
    strokeWidth: 1.7,
    'aria-hidden': true,
    style: fileTypeIconStyle,
    'data-testid': 'file-type-icon',
  } as const;
  if (kind === 'folder') {
    return <Folder {...commonProps} />;
  }
  if (kind === 'json') {
    return <FileJson {...commonProps} />;
  }
  if (kind === 'markdown') {
    return <Braces {...commonProps} />;
  }
  if (kind === 'image') {
    return <Image {...commonProps} />;
  }
  if (kind === 'audio') {
    return <Music4 {...commonProps} />;
  }
  if (kind === 'video') {
    return <Video {...commonProps} />;
  }
  if (kind === 'pdf') {
    return <FileText {...commonProps} />;
  }
  if (kind === 'archive') {
    return <FileArchive {...commonProps} />;
  }
  if (kind === 'code') {
    return <FileCode2 {...commonProps} />;
  }
  return <File {...commonProps} />;
}

function buildPathTree(resources: SidebarResourceItem[], instanceName: string): PathTreeNode[] {
  const trimmedInstanceName = instanceName.trim();
  if (trimmedInstanceName === '') {
    return [];
  }

  type MutableNode = {
    id: string;
    name: string;
    resource: SidebarResourceItem | null;
    children: Map<string, MutableNode>;
  };

  const createNode = (id: string, name: string, resource: SidebarResourceItem | null): MutableNode => ({
    id,
    name,
    resource,
    children: new Map<string, MutableNode>(),
  });

  const instanceRoot = createNode('root:instance', trimmedInstanceName, null);
  for (const resource of resources) {
    const segments = toPathSegments(normalizePathForWorkspaceTree(resource), resource.title);
    const leafName = segments[segments.length - 1] ?? resource.title;
    const folders = segments.slice(0, -1);
    let cursor = instanceRoot;
    for (const folder of folders) {
      const folderKey = `dir:${folder}`;
      const existing = cursor.children.get(folderKey);
      if (existing) {
        cursor = existing;
        continue;
      }
      const folderNode = createNode(`${cursor.id}/${encodeURIComponent(folder)}`, folder, null);
      cursor.children.set(folderKey, folderNode);
      cursor = folderNode;
    }
    const leafKey = `leaf:${resource.kind}:${resource.id}`;
    cursor.children.set(leafKey, createNode(`${cursor.id}/${leafKey}`, leafName, resource));
  }

  const serialize = (node: MutableNode): PathTreeNode[] => {
    const sorted = Array.from(node.children.values()).sort((left, right) => {
      const leftIsFile = left.resource !== null;
      const rightIsFile = right.resource !== null;
      if (leftIsFile !== rightIsFile) {
        return leftIsFile ? 1 : -1;
      }
      return left.name.localeCompare(right.name, 'zh-CN');
    });
    return sorted.map((item) => ({
      id: item.id,
      name: item.name,
      resource: item.resource,
      children: serialize(item),
    }));
  };

  return [
    {
      id: instanceRoot.id,
      name: instanceRoot.name,
      resource: instanceRoot.resource,
      children: serialize(instanceRoot),
    },
  ];
}

function renderTreeNode(
  node: PathTreeNode,
  depth: number,
  selectedResource: SelectedResource | null,
  setSelectedResource: React.Dispatch<React.SetStateAction<SelectedResource | null>>
): JSX.Element {
  if (node.resource) {
    const resource = node.resource;
    const active = selectedResource?.kind === resource.kind && selectedResource.id === resource.id;
    return (
      <button
        type="button"
        key={node.id}
        style={getTreeLeafStyle(active, depth)}
        onClick={() => setSelectedResource({ kind: resource.kind, id: resource.id })}
        aria-label={resource.ariaLabel}
      >
        <span style={treeLeafNameWrapStyle}>
          <FileTypeIcon kind={resource.iconKind} />
          <span style={treeLeafNameStyle}>{node.name}</span>
        </span>
      </button>
    );
  }

  return (
    <div key={node.id} style={getTreeFolderStyle(depth)}>
      <p style={treeFolderLabelStyle}>
        <FileTypeIcon kind="folder" />
        <span>{node.name}</span>
      </p>
      {node.children.map((child) => renderTreeNode(child, depth + 1, selectedResource, setSelectedResource))}
    </div>
  );
}

const controlStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
  border: '1px solid rgba(15, 23, 42, 0.16)',
  borderRadius: '0.35rem',
  padding: '0.35rem 0.45rem',
  fontSize: '0.8rem',
  background: 'rgba(255, 255, 255, 0.72)',
};

const controlMobileStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
};

const searchInputStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
  border: '1px solid rgba(15, 23, 42, 0.16)',
  borderRadius: '0.35rem',
  padding: '0.35rem 0.45rem',
  fontSize: '0.8rem',
  background: 'rgba(255, 255, 255, 0.72)',
};

const searchInputMobileStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
};

const buttonStyle: React.CSSProperties = {
  flexShrink: 0,
  border: '1px solid rgba(15, 23, 42, 0.16)',
  borderRadius: '0.35rem',
  background: 'rgba(255, 255, 255, 0.72)',
  color: '#1f2937',
  fontSize: '0.8rem',
  fontWeight: 600,
  padding: '0.4rem 0.68rem',
  cursor: 'pointer',
};

const buttonMobileStyle: React.CSSProperties = {
  width: '100%',
};

const mobileFabButtonStyle: React.CSSProperties = {
  position: 'fixed',
  zIndex: 980,
  border: '1px solid rgba(14, 116, 144, 0.42)',
  borderRadius: '999px',
  background: 'linear-gradient(120deg, #0f766e 0%, #0284c7 100%)',
  color: '#f8fafc',
  fontSize: '0.78rem',
  fontWeight: 700,
  padding: '0.52rem 0.84rem',
  boxShadow: '0 12px 24px -22px rgba(15, 23, 42, 0.95)',
  cursor: 'pointer',
};

const mobileSidebarDrawerOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 990,
  background: 'rgba(15, 23, 42, 0.28)',
  display: 'flex',
  alignItems: 'stretch',
  justifyContent: 'flex-start',
  padding: '0.9rem 0.6rem 0.6rem',
};

const mobileSidebarDrawerPanelStyle: React.CSSProperties = {
  width: 'min(92vw, 420px)',
  maxWidth: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.55rem',
};

const mobileSidebarDrawerHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.55rem',
};

const mobileSidebarDrawerTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.9rem',
  fontWeight: 700,
  color: '#f8fafc',
};

const mobileSidebarDrawerCloseStyle: React.CSSProperties = {
  border: '1px solid rgba(226, 232, 240, 0.44)',
  background: 'rgba(15, 23, 42, 0.4)',
  color: '#e2e8f0',
  borderRadius: '0.42rem',
  padding: '0.34rem 0.58rem',
  fontSize: '0.74rem',
  fontWeight: 600,
  cursor: 'pointer',
};

const bodyShellMobileStyle: React.CSSProperties = {};

function getBodyStyle(isMobile: boolean): React.CSSProperties {
  return {
    width: '100%',
    minHeight: 0,
    display: 'grid',
    gridTemplateColumns: '1fr',
    gridTemplateRows: isMobile ? 'minmax(220px, 36vh) minmax(0, 1fr)' : 'minmax(0, 1fr)',
    gap: '0.75rem',
    overflow: 'hidden',
    flex: 1,
  };
}

function getDesktopShellStyle(sidebarWidth: number): React.CSSProperties {
  return {
    ...desktopShellBaseStyle,
    gridTemplateColumns: `${sidebarWidth}px ${INSTANCE_FILES_SIDEBAR_RESIZER_WIDTH_PX}px minmax(0, 1fr)`,
  };
}

const desktopShellBaseStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'grid',
  gap: 0,
  overflow: 'hidden',
  background: 'rgba(255, 255, 255, 0.72)',
};

const sidebarResizeHandleStyle: React.CSSProperties = {
  width: '100%',
  minWidth: `${INSTANCE_FILES_SIDEBAR_RESIZER_WIDTH_PX}px`,
  cursor: 'col-resize',
  touchAction: 'none',
  background:
    'linear-gradient(180deg, rgba(148, 163, 184, 0.1) 0%, rgba(148, 163, 184, 0.18) 50%, rgba(148, 163, 184, 0.1) 100%)',
  borderLeft: '1px solid rgba(148, 163, 184, 0.16)',
  borderRight: '1px solid rgba(148, 163, 184, 0.16)',
};

const sidebarResizeHandleActiveStyle: React.CSSProperties = {
  background:
    'linear-gradient(180deg, rgba(14, 116, 144, 0.18) 0%, rgba(14, 116, 144, 0.26) 50%, rgba(14, 116, 144, 0.18) 100%)',
};

const listPanelStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.3)',
  borderRadius: '0.88rem',
  background: 'rgba(255, 255, 255, 0.8)',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  padding: '0.72rem',
  gap: '0.7rem',
};

const desktopSidebarStyle: React.CSSProperties = {
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.8rem',
  padding: '0.95rem 0.9rem 1rem',
  background: 'linear-gradient(180deg, rgba(248,250,252,0.96) 0%, rgba(241,245,249,0.9) 100%)',
  borderRight: '1px solid rgba(148, 163, 184, 0.22)',
};

const sidebarHeaderStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.54rem',
  paddingBottom: '0.78rem',
  borderBottom: '1px solid rgba(148, 163, 184, 0.22)',
};

const sidebarControlRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  gap: '0.5rem',
  alignItems: 'center',
};

const sidebarControlRowMobileStyle: React.CSSProperties = {
  gridTemplateColumns: '1fr',
};

const treeSectionStyle: React.CSSProperties = {
  minHeight: 0,
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.55rem',
};

const treeHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-start',
  gap: '0.5rem',
};

const panelTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.82rem',
  fontWeight: 700,
  color: '#0f172a',
};

const treeWrapStyle: React.CSSProperties = {
  minHeight: 0,
  flex: 1,
  overflowY: 'auto',
  paddingRight: '0.15rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.22rem',
  WebkitOverflowScrolling: 'touch',
  touchAction: 'pan-y',
};

const taskSourceBadgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0.14rem 0.45rem',
  borderRadius: '999px',
  background: 'rgba(2, 132, 199, 0.12)',
  color: '#0369a1',
  fontSize: '0.66rem',
  fontWeight: 700,
};

const agentDocSourceBadgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0.14rem 0.45rem',
  borderRadius: '999px',
  background: 'rgba(15, 118, 110, 0.12)',
  color: '#0f766e',
  fontSize: '0.66rem',
  fontWeight: 700,
};

const previewPanelStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.3)',
  borderRadius: '0.88rem',
  background: 'rgba(255, 255, 255, 0.84)',
  minHeight: 0,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  padding: '0.72rem',
  gap: '0.62rem',
};

const desktopPreviewPanelStyle: React.CSSProperties = {
  minHeight: 0,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.72rem',
  padding: '0.95rem 1rem 1rem',
};

const previewHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '0.75rem',
  flexWrap: 'wrap',
};

const previewHeaderCopyStyle: React.CSSProperties = {
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.24rem',
};

const previewTitleRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.45rem',
  flexWrap: 'wrap',
};

const previewTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '1rem',
  fontWeight: 800,
  color: '#0f172a',
};

const previewSubtitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.76rem',
  color: '#52616f',
  lineHeight: 1.45,
  overflowWrap: 'anywhere',
};

const previewActionRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.45rem',
  flexWrap: 'wrap',
};

const actionLinkStyle: React.CSSProperties = {
  border: '1px solid rgba(15, 118, 110, 0.35)',
  borderRadius: '0.42rem',
  padding: '0.34rem 0.58rem',
  background: 'rgba(236, 253, 245, 0.9)',
  color: '#0f766e',
  fontSize: '0.74rem',
  textDecoration: 'none',
  fontWeight: 600,
};

const metaGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: '0.42rem',
};

const metaGridMobileStyle: React.CSSProperties = {
  gridTemplateColumns: '1fr',
};

const metaItemStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  color: '#334155',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const metaItemMobileStyle: React.CSSProperties = {
  whiteSpace: 'normal',
  overflow: 'visible',
  textOverflow: 'clip',
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
};

const previewBodyStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  border: '1px solid rgba(148, 163, 184, 0.26)',
  borderRadius: '0.72rem',
  background: 'rgba(248, 250, 252, 0.8)',
  overflow: 'auto',
  WebkitOverflowScrolling: 'touch',
  touchAction: 'pan-y',
};

const desktopPreviewBodyStyle: React.CSSProperties = {
  ...previewBodyStyle,
  background: 'rgba(248, 250, 252, 0.64)',
};

const previewContentShellStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: `${INSTANCE_FILES_PREVIEW_CONTENT_MAX_WIDTH_PX}px`,
  margin: '0 auto',
  padding: '0.82rem',
  boxSizing: 'border-box',
};

const jsonStyle: React.CSSProperties = {
  margin: 0,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontSize: '0.74rem',
  color: '#0f172a',
  lineHeight: 1.45,
};

const textStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.74rem',
  color: '#0f172a',
  lineHeight: 1.5,
};

const imageStyle: React.CSSProperties = {
  maxWidth: '100%',
  height: 'auto',
  borderRadius: '0.42rem',
  border: '1px solid rgba(148, 163, 184, 0.26)',
  display: 'block',
  margin: '0 auto',
};

const hintTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.76rem',
  color: '#64748b',
};

const errorTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.76rem',
  color: '#b91c1c',
};

function getTreeFolderStyle(depth: number): React.CSSProperties {
  return {
    marginLeft: `${depth * 14}px`,
    paddingLeft: '0.6rem',
    borderLeft: depth > 0 ? '1px solid rgba(148, 163, 184, 0.28)' : 'none',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.22rem',
  };
}

function clampSidebarWidth(width: number): number {
  return Math.min(
    INSTANCE_FILES_SIDEBAR_MAX_WIDTH_PX,
    Math.max(INSTANCE_FILES_SIDEBAR_MIN_WIDTH_PX, width)
  );
}

const treeFolderLabelStyle: React.CSSProperties = {
  margin: 0,
  padding: '0.16rem 0',
  fontSize: '0.74rem',
  fontWeight: 700,
  color: '#475569',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.34rem',
};

const fileTypeIconStyle: React.CSSProperties = {
  color: '#64748b',
  flexShrink: 0,
};

function getTreeLeafStyle(active: boolean, depth: number): React.CSSProperties {
  return {
    width: '100%',
    boxSizing: 'border-box',
    marginLeft: `${depth * 14}px`,
    padding: '0.34rem 0.3rem',
    border: 'none',
    borderRadius: '0.45rem',
    background: active ? 'rgba(224, 242, 254, 0.82)' : 'transparent',
    textAlign: 'left',
    cursor: 'pointer',
    display: 'block',
  };
}

const treeLeafNameWrapStyle: React.CSSProperties = {
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: '0.34rem',
};

const treeLeafNameStyle: React.CSSProperties = {
  minWidth: 0,
  fontSize: '0.76rem',
  fontWeight: 700,
  color: '#0f172a',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
