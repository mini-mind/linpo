export const DEFAULT_BOARD_ID = 'default';
export const INSTANCE_FILES_SIDEBAR_WIDTH_PX = 320;
export const INSTANCE_FILES_SIDEBAR_MIN_WIDTH_PX = 240;
export const INSTANCE_FILES_SIDEBAR_MAX_WIDTH_PX = 560;
export const INSTANCE_FILES_SIDEBAR_RESIZER_WIDTH_PX = 10;
export const INSTANCE_FILES_PREVIEW_CONTENT_MAX_WIDTH_PX = 960;
export const WORKSPACE_ROOT_PATH = '/home/node/.openclaw/workspace/';
export const SHARED_ROOT_MARKERS = ['/.local/linpo/'];

export type SelectedResource =
  | { kind: 'task'; id: string }
  | { kind: 'agent-doc'; id: string };

export type FileIconKind =
  | 'folder'
  | 'markdown'
  | 'json'
  | 'image'
  | 'audio'
  | 'video'
  | 'pdf'
  | 'archive'
  | 'code'
  | 'text';

type SidebarResourceBase = {
  id: string;
  agentId: string;
  agentName: string;
  title: string;
  path: string;
  exists: boolean;
  updatedAt: string;
  iconKind: FileIconKind;
  ariaLabel: string;
};

export type SidebarResourceItem =
  | ({ kind: 'task' } & SidebarResourceBase)
  | ({ kind: 'agent-doc' } & SidebarResourceBase);

export type TaskSidebarResourceItem = Extract<SidebarResourceItem, { kind: 'task' }>;
export type AgentDocSidebarResourceItem = Extract<SidebarResourceItem, { kind: 'agent-doc' }>;

export type PathTreeNode = {
  id: string;
  name: string;
  resource: SidebarResourceItem | null;
  children: PathTreeNode[];
};

export type CreateDirectoryOption = {
  key: string;
  dirPath: string;
  label: string;
};

export type AgentDocGroup = {
  id: string;
  label: string;
  docs: AgentDocSidebarResourceItem[];
};
