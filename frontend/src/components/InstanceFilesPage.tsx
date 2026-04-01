import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  buildInstanceFileDownloadUrl,
  listInstanceFiles,
  listInstances,
  previewInstanceFile,
} from '../api/instanceClient';
import type {
  InstanceFileItem,
  InstanceItem,
  TaskOutputPreviewResponse,
} from '../api/types';
import { useCurrentInstanceId } from '../hooks/useCurrentInstance';
import { useIsMobile } from '../hooks/useIsMobile';
import { useToast } from '../hooks/useToast';
import { MarkdownMessage } from './MarkdownMessage';

const DEFAULT_BOARD_ID = 'default';

export function InstanceFilesPage(): JSX.Element {
  const isMobile = useIsMobile(960);
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [currentInstanceId, setCurrentInstanceId] = useCurrentInstanceId();
  const [instances, setInstances] = useState<InstanceItem[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>('');
  const [items, setItems] = useState<InstanceFileItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [onlyExisting, setOnlyExisting] = useState(false);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [preview, setPreview] = useState<TaskOutputPreviewResponse | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const selectedInstance = useMemo(
    () => instances.find((item) => item.id === selectedInstanceId) ?? null,
    [instances, selectedInstanceId]
  );
  const selectedFile = useMemo(
    () => items.find((item) => item.id === selectedFileId) ?? items[0] ?? null,
    [items, selectedFileId]
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
      setItems([]);
      setLoadError(null);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await listInstanceFiles(instanceId, {
        boardId: DEFAULT_BOARD_ID,
        q: keyword,
        onlyExisting,
      });
      setItems(response.items);
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取实例文件失败';
      setLoadError(message);
    } finally {
      setIsLoading(false);
    }
  }, [keyword, onlyExisting, selectedInstanceId]);

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
    if (items.length === 0) {
      setSelectedFileId(null);
      return;
    }
    if (selectedFileId && items.some((item) => item.id === selectedFileId)) {
      return;
    }
    setSelectedFileId(items[0].id);
  }, [items, selectedFileId]);

  useEffect(() => {
    const instanceId = selectedInstanceId.trim();
    if (!instanceId || !selectedFile) {
      setPreview(null);
      setPreviewError(null);
      setIsPreviewLoading(false);
      return;
    }
    let cancelled = false;
    setIsPreviewLoading(true);
    setPreviewError(null);
    void previewInstanceFile(instanceId, selectedFile.task_id, selectedFile.path, { boardId: DEFAULT_BOARD_ID })
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
  }, [selectedFile, selectedInstanceId]);

  const inlineUrl = useMemo(() => {
    if (!selectedFile || !selectedInstanceId.trim()) {
      return '';
    }
    return buildInstanceFileDownloadUrl(selectedInstanceId, selectedFile.task_id, selectedFile.path, {
      boardId: DEFAULT_BOARD_ID,
      download: false,
    });
  }, [selectedFile, selectedInstanceId]);
  const downloadUrl = useMemo(() => {
    if (!selectedFile || !selectedInstanceId.trim()) {
      return '';
    }
    return buildInstanceFileDownloadUrl(selectedInstanceId, selectedFile.task_id, selectedFile.path, {
      boardId: DEFAULT_BOARD_ID,
      download: true,
    });
  }, [selectedFile, selectedInstanceId]);

  return (
    <section style={pageStyle} aria-label="instance-files-page">
      <header style={isMobile ? { ...toolbarStyle, ...toolbarMobileStyle } : toolbarStyle}>
        <div style={isMobile ? { ...toolbarStatsStyle, ...toolbarStatsMobileStyle } : toolbarStatsStyle}>
          <span style={statTextStyle}>文件数 {items.length}</span>
          <span style={statTextStyle}>可访问 {items.filter((item) => item.exists).length}</span>
        </div>
        <div style={isMobile ? { ...toolbarActionsStyle, ...toolbarActionsMobileStyle } : toolbarActionsStyle}>
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
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索路径/任务"
            style={isMobile ? { ...searchInputStyle, ...searchInputMobileStyle } : searchInputStyle}
            aria-label="搜索实例文件"
          />
          <label style={isMobile ? { ...checkboxLabelStyle, ...checkboxLabelMobileStyle } : checkboxLabelStyle}>
            <input
              type="checkbox"
              checked={onlyExisting}
              onChange={(event) => setOnlyExisting(event.target.checked)}
            />
            <span>仅可访问</span>
          </label>
          <button
            type="button"
            style={isMobile ? { ...buttonStyle, ...buttonMobileStyle } : buttonStyle}
            onClick={() => void loadFiles()}
            disabled={isLoading}
          >
            {isLoading ? '刷新中...' : '刷新'}
          </button>
        </div>
      </header>

      <div style={isMobile ? bodyShellMobileStyle : bodyShellStyle}>
        <div style={getBodyStyle(isMobile)}>
        <aside style={listPanelStyle}>
          {selectedInstance ? <p style={panelTitleStyle}>实例：{selectedInstance.name}</p> : null}
          {loadError ? <p style={errorTextStyle}>{loadError}</p> : null}
          {!loadError && isLoading ? <p style={hintTextStyle}>加载中...</p> : null}
          {!loadError && !isLoading && items.length === 0 ? <p style={hintTextStyle}>暂无文件</p> : null}
          <div style={listWrapStyle}>
            {items.map((item) => {
              const active = selectedFile?.id === item.id;
              return (
                <button
                  type="button"
                  key={item.id}
                  style={getRowStyle(active)}
                  onClick={() => setSelectedFileId(item.id)}
                  aria-label={`查看文件 ${item.name}`}
                >
                  <div style={rowHeaderStyle}>
                    <span style={rowNameStyle}>{item.name}</span>
                    <span style={item.exists ? existsBadgeStyle : missingBadgeStyle}>{item.exists ? '可访问' : '缺失'}</span>
                  </div>
                  <p style={rowPathStyle} title={item.path}>{item.path}</p>
                  <p style={rowMetaStyle}>任务：{item.task_title} · 状态：{item.task_status}</p>
                </button>
              );
            })}
          </div>
        </aside>

        <article style={previewPanelStyle}>
          {!selectedFile ? (
            <p style={hintTextStyle}>选择文件后查看预览</p>
          ) : (
            <>
              <div style={previewHeaderStyle}>
                <h3 style={previewTitleStyle}>{selectedFile.name}</h3>
                <div style={previewActionRowStyle}>
                  <a href={downloadUrl} style={actionLinkStyle}>
                    下载
                  </a>
                  <button
                    type="button"
                    style={buttonStyle}
                    onClick={() => navigate('/kanban')}
                  >
                    回看板
                  </button>
                </div>
              </div>
              <div style={metaGridStyle}>
                <span style={metaItemStyle}>路径：{selectedFile.path}</span>
                <span style={metaItemStyle}>大小：{formatSize(selectedFile.size_bytes)}</span>
                <span style={metaItemStyle}>更新时间：{selectedFile.updated_at || '-'}</span>
                <span style={metaItemStyle}>任务：{selectedFile.task_title}</span>
              </div>
              <div style={previewBodyStyle}>
                {isPreviewLoading ? <p style={hintTextStyle}>加载预览...</p> : null}
                {previewError ? <p style={errorTextStyle}>{previewError}</p> : null}
                {!isPreviewLoading && !previewError && preview ? (
                  preview.kind === 'json' ? (
                    <pre style={jsonStyle}>{safePrettyJson(preview.content)}</pre>
                  ) : preview.kind === 'text' ? (
                    <MarkdownMessage text={preview.content ?? ''} style={textStyle} />
                  ) : preview.mime_type.startsWith('image/') ? (
                    <img src={inlineUrl} alt={selectedFile.name} style={imageStyle} />
                  ) : (
                    <p style={hintTextStyle}>该文件为二进制格式，暂不支持内嵌预览，请下载查看。</p>
                  )
                ) : null}
              </div>
            </>
          )}
        </article>
        </div>
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

const pageStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.55rem',
  overflow: 'hidden',
};

const toolbarStyle: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 60,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.65rem',
  flexWrap: 'wrap',
  padding: '0.55rem 0.65rem',
  border: '1px solid rgba(15, 23, 42, 0.1)',
  borderRadius: '0.4rem',
  background: 'rgba(255, 255, 255, 0.44)',
  backdropFilter: 'blur(8px)',
};

const toolbarMobileStyle: React.CSSProperties = {
  padding: '0.45rem 0.5rem',
  gap: '0.45rem',
};

const toolbarStatsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.4rem',
  flexWrap: 'wrap',
};

const toolbarStatsMobileStyle: React.CSSProperties = {
  width: '100%',
};

const statTextStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.35)',
  background: 'rgba(255, 255, 255, 0.6)',
  color: '#334155',
  borderRadius: '0.35rem',
  padding: '0.22rem 0.5rem',
  fontSize: '0.76rem',
  fontWeight: 600,
};

const toolbarActionsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
};

const toolbarActionsMobileStyle: React.CSSProperties = {
  width: '100%',
  justifyContent: 'flex-start',
};

const controlStyle: React.CSSProperties = {
  minWidth: '180px',
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
  minWidth: '240px',
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

const checkboxLabelStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.32rem',
  fontSize: '0.75rem',
  color: '#334155',
  whiteSpace: 'nowrap',
};

const checkboxLabelMobileStyle: React.CSSProperties = {
  minHeight: '2.1rem',
};

const buttonStyle: React.CSSProperties = {
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
  marginLeft: 'auto',
};

const bodyShellStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  width: '100%',
  padding: '0 0.85rem 0.85rem',
  display: 'flex',
  justifyContent: 'center',
  boxSizing: 'border-box',
};

const bodyShellMobileStyle: React.CSSProperties = {
  ...bodyShellStyle,
  padding: '0 0.5rem 0.5rem',
};

function getBodyStyle(isMobile: boolean): React.CSSProperties {
  return {
    width: '100%',
    maxWidth: isMobile ? '100%' : '1680px',
    minHeight: 0,
    display: 'grid',
    gridTemplateColumns: isMobile ? '1fr' : 'minmax(380px, 460px) minmax(0, 1fr)',
    gridTemplateRows: isMobile ? 'minmax(220px, 32vh) minmax(0, 1fr)' : undefined,
    gap: '0.62rem',
    overflow: 'hidden',
    flex: 1,
  };
}

const listPanelStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.3)',
  borderRadius: '0.6rem',
  background: 'rgba(255, 255, 255, 0.8)',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  padding: '0.58rem',
  gap: '0.45rem',
};

const panelTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  fontWeight: 700,
  color: '#0f172a',
};

const listWrapStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.42rem',
  overflowY: 'auto',
  minHeight: 0,
};

function getRowStyle(active: boolean): React.CSSProperties {
  return {
    border: active ? '1px solid rgba(14, 116, 144, 0.5)' : '1px solid rgba(148, 163, 184, 0.24)',
    background: active ? 'rgba(224, 242, 254, 0.78)' : 'rgba(248, 250, 252, 0.88)',
    borderRadius: '0.48rem',
    padding: '0.45rem 0.52rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.24rem',
    cursor: 'pointer',
    textAlign: 'left',
  };
}

const rowHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '0.4rem',
};

const rowNameStyle: React.CSSProperties = {
  fontSize: '0.76rem',
  fontWeight: 700,
  color: '#0f172a',
};

const existsBadgeStyle: React.CSSProperties = {
  fontSize: '0.64rem',
  color: '#0f766e',
  border: '1px solid rgba(15, 118, 110, 0.25)',
  borderRadius: '999px',
  padding: '0.12rem 0.42rem',
  background: 'rgba(209, 250, 229, 0.7)',
};

const missingBadgeStyle: React.CSSProperties = {
  fontSize: '0.64rem',
  color: '#9a3412',
  border: '1px solid rgba(180, 83, 9, 0.22)',
  borderRadius: '999px',
  padding: '0.12rem 0.42rem',
  background: 'rgba(255, 237, 213, 0.72)',
};

const rowPathStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.7rem',
  color: '#334155',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const rowMetaStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.67rem',
  color: '#64748b',
};

const previewPanelStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.3)',
  borderRadius: '0.6rem',
  background: 'rgba(255, 255, 255, 0.84)',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  padding: '0.62rem',
  gap: '0.52rem',
};

const previewHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.6rem',
  flexWrap: 'wrap',
};

const previewTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.84rem',
  color: '#0f172a',
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
  gap: '0.36rem',
};

const metaItemStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  color: '#334155',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const previewBodyStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  border: '1px solid rgba(148, 163, 184, 0.26)',
  borderRadius: '0.5rem',
  background: 'rgba(248, 250, 252, 0.8)',
  padding: '0.58rem',
  overflow: 'auto',
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
