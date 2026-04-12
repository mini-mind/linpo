import type React from 'react';
import { ChevronDown, ChevronRight, Folder } from 'lucide-react';
import { FileTree, FileTypeIcon } from './FileTree';
import type {
  AgentDocGroup,
  PathTreeNode,
  SelectedResource,
} from './types';
import {
  agentDocListStyle,
  agentDocSectionStyle,
  agentDocToggleCaretStyle,
  agentDocToggleStyle,
  agentGroupChildrenStyle,
  agentGroupStyle,
  desktopSidebarStyle,
  errorTextStyle,
  getAgentDocItemStyle,
  getAgentGroupToggleStyle,
  hintTextStyle,
  listPanelStyle,
  panelTitleStyle,
  searchInputMobileStyle,
  searchInputStyle,
  sidebarHeaderStyle,
  treeHeaderAddButtonStyle,
  treeHeaderStyle,
  treeLeafNameStyle,
  treeLeafNameWrapStyle,
  treeSectionStyle,
  treeWrapStyle,
} from './styles';

export function InstanceFilesSidebar({
  isMobile,
  instanceConfigHint,
  keyword,
  onKeywordChange,
  loadError,
  isLoading,
  isActionBusy,
  isEditingTaskFile,
  onOpenCreateDialog,
  taskResourceCount,
  pathTree,
  selectedResource,
  setSelectedResource,
  collapsedTreeFolderIds,
  onToggleTreeFolder,
  isAgentDocsCollapsed,
  onToggleAgentDocsCollapsed,
  agentDocGroups,
  collapsedAgentGroupIds,
  onToggleAgentGroup,
}: {
  isMobile: boolean;
  instanceConfigHint: string | null;
  keyword: string;
  onKeywordChange: (value: string) => void;
  loadError: string | null;
  isLoading: boolean;
  isActionBusy: boolean;
  isEditingTaskFile: boolean;
  onOpenCreateDialog: () => void;
  taskResourceCount: number;
  pathTree: PathTreeNode[];
  selectedResource: SelectedResource | null;
  setSelectedResource: React.Dispatch<React.SetStateAction<SelectedResource | null>>;
  collapsedTreeFolderIds: Set<string>;
  onToggleTreeFolder: (folderId: string) => void;
  isAgentDocsCollapsed: boolean;
  onToggleAgentDocsCollapsed: () => void;
  agentDocGroups: AgentDocGroup[];
  collapsedAgentGroupIds: Set<string>;
  onToggleAgentGroup: (groupId: string) => void;
}): JSX.Element {
  return (
    <aside
      style={isMobile ? listPanelStyle : desktopSidebarStyle}
      data-testid="instance-files-sidebar"
      aria-label="实例文件侧栏"
    >
      <section style={sidebarHeaderStyle}>
        {instanceConfigHint ? <p style={hintTextStyle}>{instanceConfigHint}</p> : null}
        <input
          value={keyword}
          onChange={(event) => onKeywordChange(event.target.value)}
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
          <button
            type="button"
            style={treeHeaderAddButtonStyle}
            aria-label="新增任务文件"
            onClick={onOpenCreateDialog}
            disabled={isActionBusy || isEditingTaskFile}
          >
            +
          </button>
        </div>
        {!loadError && !isLoading && taskResourceCount === 0 ? <p style={hintTextStyle}>暂无文件</p> : null}
        <div style={treeWrapStyle} data-testid="instance-files-tree">
          <FileTree
            nodes={pathTree}
            selectedResource={selectedResource}
            setSelectedResource={setSelectedResource}
            collapsedFolderIds={collapsedTreeFolderIds}
            onToggleFolder={onToggleTreeFolder}
          />
        </div>
      </section>

      {/* Agent 文档与任务文件分区展示，避免混入“共享目录”树结构。 */}
      <section style={agentDocSectionStyle}>
        <button
          type="button"
          style={agentDocToggleStyle}
          onClick={onToggleAgentDocsCollapsed}
          aria-expanded={!isAgentDocsCollapsed}
          aria-label="切换 Agents配置"
        >
          <span style={panelTitleStyle}>Agents配置</span>
          <span aria-hidden="true" style={agentDocToggleCaretStyle}>
            {isAgentDocsCollapsed ? '▸' : '▾'}
          </span>
        </button>
        {!isAgentDocsCollapsed ? (
          <div style={agentDocListStyle} data-testid="instance-agent-doc-list">
            {!loadError && !isLoading && agentDocGroups.length === 0 ? (
              <p style={hintTextStyle}>暂无文档</p>
            ) : null}
            {agentDocGroups.map((group) => {
              // 每个 Agent 独立折叠，避免文档较多时互相干扰。
              const isCollapsed = collapsedAgentGroupIds.has(group.id);
              return (
                <div key={group.id} style={agentGroupStyle}>
                  <button
                    type="button"
                    style={getAgentGroupToggleStyle(!isCollapsed)}
                    aria-label={`切换 Agent 分组 ${group.label}`}
                    aria-expanded={!isCollapsed}
                    onClick={() => onToggleAgentGroup(group.id)}
                  >
                    <span style={treeLeafNameWrapStyle}>
                      {isCollapsed ? <ChevronRight size={12} aria-hidden="true" style={{ color: '#64748b', flexShrink: 0 }} /> : <ChevronDown size={12} aria-hidden="true" style={{ color: '#64748b', flexShrink: 0 }} />}
                      <Folder size={14} aria-hidden="true" style={{ color: '#64748b', flexShrink: 0 }} />
                      <span style={treeLeafNameStyle}>{group.label}</span>
                    </span>
                  </button>
                  {!isCollapsed ? (
                    <div style={agentGroupChildrenStyle}>
                      {group.docs.map((doc) => {
                        const active = selectedResource?.kind === 'agent-doc' && selectedResource.id === doc.id;
                        return (
                          <button
                            key={doc.id}
                            type="button"
                            style={getAgentDocItemStyle(active)}
                            onClick={() => setSelectedResource({ kind: 'agent-doc', id: doc.id })}
                            aria-label={doc.ariaLabel}
                          >
                            <span style={treeLeafNameWrapStyle}>
                              <FileTypeIcon kind={doc.iconKind} />
                              <span style={treeLeafNameStyle}>{doc.title}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </section>
    </aside>
  );
}
