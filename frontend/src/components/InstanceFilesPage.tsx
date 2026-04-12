import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  buildInstanceAgentDocDownloadUrl,
  buildInstanceFileDownloadUrl,
  deleteInstanceFile,
  listInstanceAgentDocs,
  listInstanceFiles,
  previewInstanceAgentDoc,
  previewInstanceFile,
  resolveSingleInstance,
  writeInstanceFile,
} from '../api/instanceClient';
import type { InstanceAgentDocItem, InstanceFileItem, TaskOutputPreviewResponse } from '../api/types';
import { useDraggableFab } from '../hooks/useDraggableFab';
import { useIsMobile } from '../hooks/useIsMobile';
import { useToast } from '../hooks/useToast';
import {
  getWorkspaceBodyInnerStyle,
  getWorkspaceBodyShellStyle,
  getWorkspacePageStyle,
  WORKSPACE_CONTENT_MAX_WIDTH_PX,
} from './workspaceLayout';
import { InstanceFilesCreateDialog } from './instance-files-page/InstanceFilesCreateDialog';
import { InstanceFilesPreviewPanel } from './instance-files-page/PreviewPanel';
import { InstanceFilesSidebar } from './instance-files-page/Sidebar';
import {
  bodyInnerDesktopStyle,
  bodyShellDesktopStyle,
  bodyShellMobileStyle,
  getBodyStyle,
  getDesktopShellStyle,
  mobileFabButtonStyle,
  mobileSidebarDrawerCloseStyle,
  mobileSidebarDrawerHeaderStyle,
  mobileSidebarDrawerOverlayStyle,
  mobileSidebarDrawerPanelStyle,
  mobileSidebarDrawerTitleStyle,
  sidebarResizeHandleActiveStyle,
  sidebarResizeHandleStyle,
  workspacePageEdgeStyle,
} from './instance-files-page/styles';
import {
  DEFAULT_BOARD_ID,
  INSTANCE_FILES_SIDEBAR_WIDTH_PX,
  type AgentDocGroup,
  type AgentDocSidebarResourceItem,
  type CreateDirectoryOption,
  type SelectedResource,
  type TaskSidebarResourceItem,
} from './instance-files-page/types';
import { useSidebarResize } from './instance-files-page/useSidebarResize';
import {
  buildPathTree,
  collectFolderNodeIds,
  getRelativeDirectoryPath,
  normalizeComparablePath,
  resolveFileIconKind,
} from './instance-files-page/utils';

export function InstanceFilesPage(): JSX.Element {
  const isMobile = useIsMobile(960);
  const { addToast } = useToast();

  const [currentInstance, setCurrentInstance] = useState<{ id: string; name: string } | null>(null);
  const [instanceConfigHint, setInstanceConfigHint] = useState<string | null>(null);
  const [taskItems, setTaskItems] = useState<InstanceFileItem[]>([]);
  const [agentDocs, setAgentDocs] = useState<InstanceAgentDocItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [selectedResource, setSelectedResource] = useState<SelectedResource | null>(null);
  const [preview, setPreview] = useState<TaskOutputPreviewResponse | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isEditingTaskFile, setIsEditingTaskFile] = useState(false);
  const [editorContent, setEditorContent] = useState('');
  const [isSavingTaskFile, setIsSavingTaskFile] = useState(false);
  const [isDeletingTaskFile, setIsDeletingTaskFile] = useState(false);
  const [isCreatingTaskFile, setIsCreatingTaskFile] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [createTargetKey, setCreateTargetKey] = useState('');
  const [createFileName, setCreateFileName] = useState('');
  const [pendingSelectTaskFile, setPendingSelectTaskFile] = useState<{ path: string } | null>(null);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isAgentDocsCollapsed, setIsAgentDocsCollapsed] = useState(true);
  const [collapsedTreeFolderIds, setCollapsedTreeFolderIds] = useState<Set<string>>(new Set());
  const [collapsedAgentGroupIds, setCollapsedAgentGroupIds] = useState<Set<string>>(new Set());

  const filesFab = useDraggableFab('linpo.mobile_fab.instance_files_sidebar', { x: 16, y: 88 });
  const { desktopSidebarWidth, isSidebarResizing, handleSidebarResizePointerDown } = useSidebarResize(
    INSTANCE_FILES_SIDEBAR_WIDTH_PX,
    isMobile
  );

  const currentInstanceId = currentInstance?.id ?? '';

  const selectedTaskFile = useMemo(
    () =>
      selectedResource?.kind === 'task'
        ? taskItems.find((item) => item.id === selectedResource.id) ?? null
        : null,
    [selectedResource, taskItems]
  );
  const selectedTaskId = useMemo(
    () => (selectedTaskFile && selectedTaskFile.task_id !== 'shared' ? selectedTaskFile.task_id : null),
    [selectedTaskFile]
  );
  const selectedAgentDoc = useMemo(
    () =>
      selectedResource?.kind === 'agent-doc'
        ? agentDocs.find((item) => item.id === selectedResource.id) ?? null
        : null,
    [agentDocs, selectedResource]
  );

  // Agent 文档只允许预览，不进入编辑流程。
  const isAgentDocReadonly = selectedResource?.kind === 'agent-doc';
  const isAgentDocMarkdown = Boolean(selectedAgentDoc && /\.md$/i.test(selectedAgentDoc.name.trim()));

  const loadInstanceContext = useCallback(async () => {
    try {
      const { instance, total } = await resolveSingleInstance();
      if (instance) {
        setCurrentInstance({ id: instance.id, name: instance.name });
        setInstanceConfigHint(null);
        return;
      }
      setCurrentInstance(null);
      if (total <= 0) {
        setInstanceConfigHint('未检测到可用实例。请先在服务端配置 1 个实例后刷新。');
      } else {
        setInstanceConfigHint('检测到多个实例。开源版仅支持单实例，请在服务端仅保留 1 个实例。');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取实例失败';
      addToast(message, 'error');
      setCurrentInstance(null);
      setInstanceConfigHint('读取实例配置失败，请检查后端实例配置并重试。');
    }
  }, [addToast]);

  const loadFiles = useCallback(async () => {
    const instanceId = currentInstanceId.trim();
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
  }, [currentInstanceId, keyword]);

  useEffect(() => {
    void loadInstanceContext();
  }, [loadInstanceContext]);

  useEffect(() => {
    if (!currentInstanceId.trim()) {
      return;
    }
    const timer = window.setTimeout(() => {
      void loadFiles();
    }, 220);
    return () => {
      window.clearTimeout(timer);
    };
  }, [currentInstanceId, loadFiles]);

  useEffect(() => {
    const instanceId = currentInstanceId.trim();
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
        ? previewInstanceFile(instanceId, selectedTaskId, selectedTaskFile.path, {
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
  }, [currentInstanceId, selectedAgentDoc, selectedResource, selectedTaskFile, selectedTaskId]);

  useEffect(() => {
    setIsEditingTaskFile(false);
    setEditorContent('');
    setIsCreateDialogOpen(false);
    setCreateTargetKey('');
    setCreateFileName('');
  }, [selectedResource?.id, selectedResource?.kind]);

  const canEditTaskFile = useMemo(() => {
    if (!selectedTaskFile || isAgentDocReadonly) {
      return false;
    }
    if (!selectedTaskFile.exists) {
      return true;
    }
    return preview?.kind === 'text' || preview?.kind === 'json';
  }, [isAgentDocReadonly, preview?.kind, selectedTaskFile]);

  useEffect(() => {
    if (!isEditingTaskFile || !selectedTaskFile) {
      return;
    }
    if (!selectedTaskFile.exists) {
      setEditorContent((current) => current);
      return;
    }
    if (preview?.kind === 'text' || preview?.kind === 'json') {
      setEditorContent(preview.content ?? '');
    }
  }, [isEditingTaskFile, preview?.content, preview?.kind, selectedTaskFile]);

  const inlineUrl = useMemo(() => {
    if (!currentInstanceId.trim()) {
      return '';
    }
    if (selectedResource?.kind === 'task' && selectedTaskFile) {
      return buildInstanceFileDownloadUrl(currentInstanceId, selectedTaskId, selectedTaskFile.path, {
        boardId: DEFAULT_BOARD_ID,
        download: false,
      });
    }
    if (selectedResource?.kind === 'agent-doc' && selectedAgentDoc) {
      return buildInstanceAgentDocDownloadUrl(currentInstanceId, selectedAgentDoc.agent_id, selectedAgentDoc.name, {
        download: false,
      });
    }
    return '';
  }, [currentInstanceId, selectedAgentDoc, selectedResource, selectedTaskFile, selectedTaskId]);

  const downloadUrl = useMemo(() => {
    if (!currentInstanceId.trim()) {
      return '';
    }
    if (selectedResource?.kind === 'task' && selectedTaskFile) {
      return buildInstanceFileDownloadUrl(currentInstanceId, selectedTaskId, selectedTaskFile.path, {
        boardId: DEFAULT_BOARD_ID,
        download: true,
      });
    }
    if (selectedResource?.kind === 'agent-doc' && selectedAgentDoc) {
      return buildInstanceAgentDocDownloadUrl(currentInstanceId, selectedAgentDoc.agent_id, selectedAgentDoc.name, {
        download: true,
      });
    }
    return '';
  }, [currentInstanceId, selectedAgentDoc, selectedResource, selectedTaskFile, selectedTaskId]);

  const taskResourceItems = useMemo<TaskSidebarResourceItem[]>(
    () =>
      taskItems.map<TaskSidebarResourceItem>((item) => ({
        kind: 'task' as const,
        id: item.id,
        agentId: item.agent_id,
        agentName: item.agent_name,
        title: item.name,
        path: item.path,
        exists: item.exists,
        updatedAt: item.updated_at,
        iconKind: resolveFileIconKind(item.path, item.name),
        ariaLabel: `查看任务文件 ${item.name}`,
      })),
    [taskItems]
  );

  const agentDocResourceItems = useMemo<AgentDocSidebarResourceItem[]>(
    () =>
      agentDocs
        .map<AgentDocSidebarResourceItem>((doc) => ({
          kind: 'agent-doc' as const,
          id: doc.id,
          agentId: doc.agent_id,
          agentName: doc.agent_name,
          title: doc.name,
          path: doc.path,
          exists: doc.exists,
          updatedAt: doc.updated_at,
          iconKind: resolveFileIconKind(doc.path, doc.name),
          ariaLabel: `查看 Agent 文档 ${doc.name}`,
        }))
        .sort((left, right) => left.path.localeCompare(right.path, 'zh-CN')),
    [agentDocs]
  );

  const agentDocGroups = useMemo<AgentDocGroup[]>(() => {
    // Agents 配置区按 Agent 聚合，保证“先 Agent、后文档”的二级浏览语义。
    const grouped = new Map<string, AgentDocGroup>();
    for (const doc of agentDocResourceItems) {
      const label = doc.agentName.trim() || doc.agentId;
      const key = `${doc.agentId}::${label}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.docs.push(doc);
        continue;
      }
      grouped.set(key, {
        id: key,
        label,
        docs: [doc],
      });
    }
    return Array.from(grouped.values())
      .map((group) => ({
        ...group,
        docs: group.docs.sort((left, right) => left.title.localeCompare(right.title, 'zh-CN')),
      }))
      .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'));
  }, [agentDocResourceItems]);

  const createDirectoryOptions = useMemo<CreateDirectoryOption[]>(() => {
    // 新建入口固定挂在共享目录根，不再展示宿主绝对路径前缀。
    const sharedRootPath = '';
    const sharedRootKey = '__shared_root__';
    const unique = new Map<string, CreateDirectoryOption>();
    unique.set(sharedRootKey, {
      key: sharedRootKey,
      dirPath: sharedRootPath,
      label: '/',
    });
    for (const item of taskItems) {
      const dirPath = getRelativeDirectoryPath(item.path);
      if (dirPath === null) {
        continue;
      }
      const key = normalizeComparablePath(dirPath);
      if (unique.has(key)) {
        continue;
      }
      unique.set(key, {
        key,
        dirPath,
        label: dirPath ? `/${dirPath}` : '/',
      });
    }
    return Array.from(unique.values()).sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'));
  }, [taskItems]);

  // 文件树直接挂载共享目录，不再额外渲染“共享目录”根节点按钮。
  const pathTree = useMemo(() => buildPathTree(taskResourceItems), [taskResourceItems]);
  const pathTreeFolderIds = useMemo(() => collectFolderNodeIds(pathTree), [pathTree]);
  const agentDocGroupIds = useMemo(() => new Set(agentDocGroups.map((group) => group.id)), [agentDocGroups]);

  useEffect(() => {
    // 数据刷新后回收失效目录折叠态，避免引用已经不存在的节点 ID。
    setCollapsedTreeFolderIds((previous) => {
      const next = new Set(Array.from(previous).filter((folderId) => pathTreeFolderIds.has(folderId)));
      return next.size === previous.size ? previous : next;
    });
  }, [pathTreeFolderIds]);

  useEffect(() => {
    // Agent 分组动态变化时同步清理折叠态，保持 UI 状态与当前分组一致。
    setCollapsedAgentGroupIds((previous) => {
      const next = new Set(Array.from(previous).filter((groupId) => agentDocGroupIds.has(groupId)));
      return next.size === previous.size ? previous : next;
    });
  }, [agentDocGroupIds]);

  useEffect(() => {
    const resourceStillExists =
      selectedResource &&
      (taskResourceItems.some((item) => item.kind === selectedResource.kind && item.id === selectedResource.id) ||
        agentDocResourceItems.some((item) => item.kind === selectedResource.kind && item.id === selectedResource.id));
    if (resourceStillExists) {
      return;
    }

    // 默认优先落到任务文件，避免选中“文件树不可见”的文档项。
    const fallbackTask = taskResourceItems[0];
    if (fallbackTask) {
      setSelectedResource({ kind: fallbackTask.kind, id: fallbackTask.id });
      return;
    }
    const fallbackAgentDoc = agentDocResourceItems[0];
    if (fallbackAgentDoc) {
      setSelectedResource({ kind: fallbackAgentDoc.kind, id: fallbackAgentDoc.id });
      return;
    }
    setSelectedResource(null);
  }, [agentDocResourceItems, selectedResource, taskResourceItems]);

  useEffect(() => {
    if (!pendingSelectTaskFile) {
      return;
    }
    const matched = taskItems.find(
      (item) => normalizeComparablePath(item.path) === normalizeComparablePath(pendingSelectTaskFile.path)
    );
    if (!matched) {
      return;
    }
    // 新建后优先自动定位到目标文件，减少用户再次查找成本。
    setSelectedResource({ kind: 'task', id: matched.id });
    setPendingSelectTaskFile(null);
  }, [pendingSelectTaskFile, taskItems]);

  useEffect(() => {
    if (!isMobile) {
      setIsMobileSidebarOpen(false);
    }
  }, [isMobile]);

  const handleStartEditTaskFile = useCallback(() => {
    if (!selectedTaskFile || !canEditTaskFile) {
      return;
    }
    if (!selectedTaskFile.exists) {
      setEditorContent('');
    } else if (preview?.kind === 'text' || preview?.kind === 'json') {
      setEditorContent(preview.content ?? '');
    }
    setIsEditingTaskFile(true);
  }, [canEditTaskFile, preview?.content, preview?.kind, selectedTaskFile]);

  const handleSaveTaskFile = useCallback(async () => {
    const instanceId = currentInstanceId.trim();
    if (!instanceId || !selectedTaskFile || !canEditTaskFile) {
      return;
    }
    setIsSavingTaskFile(true);
    try {
      await writeInstanceFile(instanceId, {
        taskId: selectedTaskId,
        boardId: DEFAULT_BOARD_ID,
        path: selectedTaskFile.path,
        content: editorContent,
      });
      addToast('文件已保存', 'success');
      setIsEditingTaskFile(false);
      await loadFiles();
      const refreshed = await previewInstanceFile(instanceId, selectedTaskId, selectedTaskFile.path, {
        boardId: DEFAULT_BOARD_ID,
      });
      setPreview(refreshed);
      setPreviewError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存文件失败';
      addToast(message, 'error');
    } finally {
      setIsSavingTaskFile(false);
    }
  }, [addToast, canEditTaskFile, currentInstanceId, editorContent, loadFiles, selectedTaskFile, selectedTaskId]);

  const handleDeleteTaskFile = useCallback(async () => {
    const instanceId = currentInstanceId.trim();
    if (!instanceId || !selectedTaskFile || !selectedTaskFile.exists) {
      return;
    }
    const confirmed = window.confirm(`确认删除文件 ${selectedTaskFile.name} 吗？`);
    if (!confirmed) {
      return;
    }
    setIsDeletingTaskFile(true);
    try {
      await deleteInstanceFile(instanceId, {
        taskId: selectedTaskId,
        boardId: DEFAULT_BOARD_ID,
        path: selectedTaskFile.path,
      });
      addToast('文件已删除', 'success');
      setIsEditingTaskFile(false);
      setEditorContent('');
      await loadFiles();
      setPreview(null);
      setPreviewError('文件已删除');
    } catch (error) {
      const message = error instanceof Error ? error.message : '删除文件失败';
      addToast(message, 'error');
    } finally {
      setIsDeletingTaskFile(false);
    }
  }, [addToast, currentInstanceId, loadFiles, selectedTaskFile, selectedTaskId]);

  const handleOpenCreateDialog = useCallback(() => {
    const selectedDir = selectedTaskFile ? getRelativeDirectoryPath(selectedTaskFile.path) ?? '' : '';
    const preferred = createDirectoryOptions.find(
      (option) => normalizeComparablePath(option.dirPath) === normalizeComparablePath(selectedDir)
    );
    setCreateTargetKey((preferred ?? createDirectoryOptions[0]).key);
    setCreateFileName('');
    setIsCreateDialogOpen(true);
  }, [createDirectoryOptions, selectedTaskFile]);

  const handleCreateTaskFile = useCallback(async () => {
    const instanceId = currentInstanceId.trim();
    if (!instanceId || isCreatingTaskFile) {
      return;
    }
    const target = createDirectoryOptions.find((item) => item.key === createTargetKey);
    if (!target) {
      addToast('请选择创建目录', 'error');
      return;
    }
    const normalizedFileName = createFileName.trim();
    if (!normalizedFileName) {
      addToast('请输入文件名', 'error');
      return;
    }
    if (normalizedFileName.includes('/') || normalizedFileName.includes('\\')) {
      addToast('文件名不能包含路径分隔符，请使用目录选择器', 'error');
      return;
    }

    // 统一收敛目录和文件名，避免双斜杠路径进入后端。
    const normalizedDirectory = target.dirPath.replace(/[\\\/]+$/, '');
    const nextPath = normalizedDirectory ? `${normalizedDirectory}/${normalizedFileName}` : normalizedFileName;
    const hasDuplicatePath = taskItems.some(
      (item) => normalizeComparablePath(item.path) === normalizeComparablePath(nextPath)
    );
    if (hasDuplicatePath) {
      addToast('共享目录中已存在同名文件', 'error');
      return;
    }

    setIsCreatingTaskFile(true);
    try {
      const created = await writeInstanceFile(instanceId, {
        boardId: DEFAULT_BOARD_ID,
        path: nextPath,
        content: '',
      });
      addToast('文件已新建', 'success');
      setIsCreateDialogOpen(false);
      setCreateFileName('');
      // 新建后自动选中目标文件，便于继续编辑。
      setPendingSelectTaskFile({
        path: created.path || nextPath,
      });
      await loadFiles();
    } catch (error) {
      const message = error instanceof Error ? error.message : '新建文件失败';
      addToast(message, 'error');
    } finally {
      setIsCreatingTaskFile(false);
    }
  }, [addToast, createDirectoryOptions, createFileName, createTargetKey, currentInstanceId, isCreatingTaskFile, loadFiles, taskItems]);

  const handleCloseCreateDialog = useCallback(() => {
    if (isCreatingTaskFile) {
      return;
    }
    setIsCreateDialogOpen(false);
  }, [isCreatingTaskFile]);

  const isActionBusy = isSavingTaskFile || isDeletingTaskFile || isCreatingTaskFile;
  const canStartEdit = Boolean(selectedTaskFile) && canEditTaskFile && !isEditingTaskFile && !isActionBusy;
  const canDeleteTask = Boolean(selectedTaskFile?.exists) && !isAgentDocReadonly && !isEditingTaskFile && !isActionBusy;

  const handleToggleTreeFolder = useCallback((folderId: string) => {
    setCollapsedTreeFolderIds((previous) => {
      const next = new Set(previous);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  const handleToggleAgentGroup = useCallback((groupId: string) => {
    setCollapsedAgentGroupIds((previous) => {
      const next = new Set(previous);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  const sidebarNode = (
    <InstanceFilesSidebar
      isMobile={isMobile}
      instanceConfigHint={instanceConfigHint}
      keyword={keyword}
      onKeywordChange={setKeyword}
      loadError={loadError}
      isLoading={isLoading}
      isActionBusy={isActionBusy}
      isEditingTaskFile={isEditingTaskFile}
      onOpenCreateDialog={handleOpenCreateDialog}
      taskResourceCount={taskResourceItems.length}
      pathTree={pathTree}
      selectedResource={selectedResource}
      setSelectedResource={setSelectedResource}
      collapsedTreeFolderIds={collapsedTreeFolderIds}
      onToggleTreeFolder={handleToggleTreeFolder}
      isAgentDocsCollapsed={isAgentDocsCollapsed}
      onToggleAgentDocsCollapsed={() => setIsAgentDocsCollapsed((value) => !value)}
      agentDocGroups={agentDocGroups}
      collapsedAgentGroupIds={collapsedAgentGroupIds}
      onToggleAgentGroup={handleToggleAgentGroup}
    />
  );

  const previewNode = (
    <InstanceFilesPreviewPanel
      isMobile={isMobile}
      loadError={loadError}
      isLoading={isLoading}
      selectedResource={selectedResource}
      selectedTaskFile={selectedTaskFile}
      selectedAgentDoc={selectedAgentDoc}
      currentInstanceName={currentInstance?.name ?? ''}
      isAgentDocMarkdown={isAgentDocMarkdown}
      isAgentDocReadonly={Boolean(isAgentDocReadonly)}
      isPreviewLoading={isPreviewLoading}
      previewError={previewError}
      preview={preview}
      isEditingTaskFile={isEditingTaskFile}
      editorContent={editorContent}
      onEditorContentChange={setEditorContent}
      canStartEdit={canStartEdit}
      canDeleteTask={canDeleteTask}
      isSavingTaskFile={isSavingTaskFile}
      isDeletingTaskFile={isDeletingTaskFile}
      onStartEditTaskFile={handleStartEditTaskFile}
      onCancelEditTaskFile={() => setIsEditingTaskFile(false)}
      onSaveTaskFile={() => {
        void handleSaveTaskFile();
      }}
      onDeleteTaskFile={() => {
        void handleDeleteTaskFile();
      }}
      downloadUrl={downloadUrl}
      inlineUrl={inlineUrl}
    />
  );

  if (isMobile) {
    return (
      <section style={getWorkspacePageStyle({ extra: workspacePageEdgeStyle })} aria-label="instance-files-page">
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
            <div style={mobileSidebarDrawerPanelStyle} onClick={(event) => event.stopPropagation()}>
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
        <InstanceFilesCreateDialog
          isOpen={isCreateDialogOpen}
          createTargetKey={createTargetKey}
          createFileName={createFileName}
          createDirectoryOptions={createDirectoryOptions}
          isCreatingTaskFile={isCreatingTaskFile}
          onClose={handleCloseCreateDialog}
          onTargetKeyChange={setCreateTargetKey}
          onFileNameChange={setCreateFileName}
          onCreate={handleCreateTaskFile}
        />
      </section>
    );
  }

  return (
    <section style={getWorkspacePageStyle({ extra: workspacePageEdgeStyle })} aria-label="instance-files-page">
      <div style={getWorkspaceBodyShellStyle({ isMobile: false, desktopPadding: '0', extra: bodyShellDesktopStyle })}>
        <div
          style={getWorkspaceBodyInnerStyle({
            isMobile: false,
            // 桌面双栏要求贴满容器，不在侧栏与主区边界引入额外外层留白。
            extra: bodyInnerDesktopStyle,
          })}
        >
          <div style={getDesktopShellStyle(desktopSidebarWidth)} data-testid="instance-files-shell">
            {sidebarNode}
            {previewNode}
            <div
              role="separator"
              aria-label="调整侧栏宽度"
              aria-orientation="vertical"
              data-testid="instance-files-sidebar-resizer"
              onPointerDown={handleSidebarResizePointerDown}
              // 拖拽条覆盖在分界线中线，不单独占据一列，避免出现边界留白带。
              style={{
                ...(isSidebarResizing
                  ? { ...sidebarResizeHandleStyle, ...sidebarResizeHandleActiveStyle }
                  : sidebarResizeHandleStyle),
                left: `${desktopSidebarWidth}px`,
              }}
            />
          </div>
        </div>
      </div>
      <InstanceFilesCreateDialog
        isOpen={isCreateDialogOpen}
        createTargetKey={createTargetKey}
        createFileName={createFileName}
        createDirectoryOptions={createDirectoryOptions}
        isCreatingTaskFile={isCreatingTaskFile}
        onClose={handleCloseCreateDialog}
        onTargetKeyChange={setCreateTargetKey}
        onFileNameChange={setCreateFileName}
        onCreate={handleCreateTaskFile}
      />
    </section>
  );
}
