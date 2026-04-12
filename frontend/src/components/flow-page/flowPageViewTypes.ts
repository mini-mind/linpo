export type FlowSidebarMode = 'desktop' | 'drawer';

export type FlowSidebarItem = {
  id: string;
  name: string;
  source: 'submitted' | 'draft';
  updatedAt: string;
  statusLabel: string;
  nodeCount: number;
  hasSubmitted: boolean;
  hasDraft: boolean;
};
