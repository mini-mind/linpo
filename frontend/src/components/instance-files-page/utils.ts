import type { InstanceFileItem } from '../../api/types';
import type { FileIconKind, PathTreeNode, SidebarResourceItem } from './types';

export const DEFAULT_BOARD_ID = 'default';
export const INSTANCE_FILES_SIDEBAR_MIN_WIDTH_PX = 240;
export const INSTANCE_FILES_SIDEBAR_MAX_WIDTH_PX = 560;
export const WORKSPACE_ROOT_PATH = '/home/node/.openclaw/workspace/';
export const SHARED_ROOT_MARKERS = ['/.local/linpo/'];

export function safePrettyJson(value: string | null): string {
  if (!value) return '';
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

export function formatSize(sizeBytes: number | null): string {
  if (sizeBytes === null || sizeBytes < 0) return '-';
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function getRequirementLabel(item: InstanceFileItem): string {
  return item.requirement_title?.trim() || item.requirement_id?.trim() || '未命名流程';
}

export function formatDateTime(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }
  return new Date(parsed).toLocaleString('zh-CN', { hour12: false });
}

export function normalizeComparablePath(path: string): string {
  return path.replace(/\\/g, '/').trim().replace(/^\/+/, '');
}

export function getParentDirectoryPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').trim();
  if (!normalized) {
    return '';
  }
  const slashIndex = normalized.lastIndexOf('/');
  if (slashIndex <= 0) {
    return '';
  }
  return normalized.slice(0, slashIndex);
}

export function resolveKnownRootRelativePath(path: string): string | null {
  const normalized = path.replace(/\\/g, '/').trim();
  if (!normalized) {
    return '';
  }
  if (normalized.startsWith(WORKSPACE_ROOT_PATH)) {
    return normalized.slice(WORKSPACE_ROOT_PATH.length).replace(/^\/+/, '');
  }

  // 兼容共享目录历史路径：先定位 marker，再跳过 board 目录，最终输出可展示的相对路径。
  for (const marker of SHARED_ROOT_MARKERS) {
    const index = normalized.indexOf(marker);
    if (index < 0) {
      continue;
    }
    const markerTail = normalized.slice(index + marker.length);
    const boardSeparatorIndex = markerTail.indexOf('/');
    if (boardSeparatorIndex < 0) {
      return '';
    }
    return markerTail.slice(boardSeparatorIndex + 1).replace(/^\/+/, '');
  }
  return null;
}

export function getRelativeDirectoryPath(path: string): string | null {
  const relative = resolveKnownRootRelativePath(path);
  if (relative !== null) {
    return getParentDirectoryPath(relative);
  }
  const normalized = path.replace(/\\/g, '/').trim().replace(/^\/+/, '');
  return getParentDirectoryPath(normalized);
}

export function toPathSegments(path: string, fallbackName: string): string[] {
  const normalized = path.replace(/\\/g, '/').trim();
  if (!normalized) {
    return [fallbackName];
  }
  const genericSegments = normalized.split('/').filter((item) => item.trim() !== '');
  return genericSegments.length > 0 ? genericSegments : [fallbackName];
}

export function normalizePathForWorkspaceTree(resource: SidebarResourceItem): string {
  const normalized = resource.path.replace(/\\/g, '/').trim();
  if (!normalized) {
    return resource.title;
  }
  if (normalized.startsWith('agent://')) {
    const tail = normalized.slice('agent://'.length).replace(/^\/+/, '');
    if (!tail) {
      return resource.title;
    }
    const agentPrefix = `${resource.agentId}/`;
    if (tail.startsWith(agentPrefix)) {
      return tail.slice(agentPrefix.length) || resource.title;
    }
    return tail;
  }
  const knownRootRelativePath = resolveKnownRootRelativePath(normalized);
  if (knownRootRelativePath !== null) {
    return knownRootRelativePath || resource.title;
  }
  if (normalized.startsWith('/')) {
    return normalized.replace(/^\/+/, '');
  }
  return normalized;
}

export function resolveFileIconKind(path: string, title: string): FileIconKind {
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

export function buildPathTree(resources: SidebarResourceItem[]): PathTreeNode[] {
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

  // 共享目录作为唯一挂载点：目录节点统一放前面，文件节点按名称排序。
  const sharedRoot = createNode('root:shared-directory', '共享目录', null);
  for (const resource of resources) {
    const segments = toPathSegments(normalizePathForWorkspaceTree(resource), resource.title);
    const leafName = segments[segments.length - 1] ?? resource.title;
    const folders = segments.slice(0, -1);
    let cursor = sharedRoot;
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

  return serialize(sharedRoot);
}

export function collectFolderNodeIds(nodes: PathTreeNode[]): Set<string> {
  const folderIds = new Set<string>();
  const walk = (currentNodes: PathTreeNode[]) => {
    for (const node of currentNodes) {
      if (!node.resource) {
        folderIds.add(node.id);
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return folderIds;
}

export function clampSidebarWidth(width: number): number {
  return Math.min(
    INSTANCE_FILES_SIDEBAR_MAX_WIDTH_PX,
    Math.max(INSTANCE_FILES_SIDEBAR_MIN_WIDTH_PX, width)
  );
}
