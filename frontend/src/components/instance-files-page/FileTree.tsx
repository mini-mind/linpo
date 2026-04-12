import type React from 'react';
import { Braces, ChevronDown, ChevronRight, File, FileArchive, FileCode2, FileJson, FileText, Folder, Image, Music4, Video } from 'lucide-react';
import type { FileIconKind, PathTreeNode, SelectedResource } from './types';
import {
  fileTypeIconStyle,
  getTreeFolderStyle,
  getTreeFolderToggleStyle,
  getTreeLeafStyle,
  treeCaretIconStyle,
  treeLeafNameStyle,
  treeLeafNameWrapStyle,
} from './styles';

export function FileTypeIcon({ kind }: { kind: FileIconKind }): JSX.Element {
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

function renderTreeNode(
  node: PathTreeNode,
  depth: number,
  selectedResource: SelectedResource | null,
  setSelectedResource: React.Dispatch<React.SetStateAction<SelectedResource | null>>,
  collapsedFolderIds: Set<string>,
  onToggleFolder: (folderId: string) => void
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

  const isCollapsed = collapsedFolderIds.has(node.id);
  return (
    <div key={node.id} style={getTreeFolderStyle(depth)}>
      <button
        type="button"
        style={getTreeFolderToggleStyle(isCollapsed)}
        aria-label={`切换目录 ${node.name}`}
        aria-expanded={!isCollapsed}
        onClick={() => onToggleFolder(node.id)}
      >
        <span style={treeLeafNameWrapStyle}>
          {isCollapsed ? <ChevronRight size={12} aria-hidden="true" style={treeCaretIconStyle} /> : <ChevronDown size={12} aria-hidden="true" style={treeCaretIconStyle} />}
          <FileTypeIcon kind="folder" />
          <span style={treeLeafNameStyle}>{node.name}</span>
        </span>
      </button>
      {!isCollapsed
        ? node.children.map((child) =>
            renderTreeNode(child, depth + 1, selectedResource, setSelectedResource, collapsedFolderIds, onToggleFolder)
          )
        : null}
    </div>
  );
}

export function FileTree({
  nodes,
  selectedResource,
  setSelectedResource,
  collapsedFolderIds,
  onToggleFolder,
}: {
  nodes: PathTreeNode[];
  selectedResource: SelectedResource | null;
  setSelectedResource: React.Dispatch<React.SetStateAction<SelectedResource | null>>;
  collapsedFolderIds: Set<string>;
  onToggleFolder: (folderId: string) => void;
}): JSX.Element {
  return (
    <>
      {nodes.map((node) => renderTreeNode(node, 0, selectedResource, setSelectedResource, collapsedFolderIds, onToggleFolder))}
    </>
  );
}
