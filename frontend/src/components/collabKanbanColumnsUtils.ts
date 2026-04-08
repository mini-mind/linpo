import type { BoardTask, BoardViewMode, TaskStatus } from './kanbanTypes';

export type StatusColumnKey = 'pending_confirmation' | TaskStatus | 'blocked';

export type FlowColumnState = 'running' | 'blocked' | 'approval' | 'idle';

export type BoardColumn = {
  id: string;
  title: string;
  tasks: BoardTask[];
  flowId?: string;
  flowState?: FlowColumnState;
};

type StatusColumnConfig = {
  key: StatusColumnKey;
  title: string;
};

export function resolveStatusColumnKey(task: BoardTask): StatusColumnKey {
  const dispatchStatus = String(task.extras.dispatch_status ?? '').trim().toLowerCase();
  if (dispatchStatus === 'interrupted' || dispatchStatus === 'stopped' || dispatchStatus === 'blocked') {
    return 'blocked';
  }
  return task.status;
}

export function isInterruptedBlockedFlowTask(task: BoardTask): boolean {
  if (task.status !== 'blocked_by_approval') {
    return false;
  }
  const dispatchStatus = String(task.extras.dispatch_status ?? '').trim().toLowerCase();
  return dispatchStatus === 'interrupted' || dispatchStatus === 'stopped' || dispatchStatus === 'blocked';
}

export function resolveFlowColumnState(tasks: BoardTask[]): FlowColumnState {
  if (tasks.some((task) => task.status === 'running' || task.status === 'queued')) {
    return 'running';
  }
  if (tasks.some((task) => isInterruptedBlockedFlowTask(task))) {
    return 'blocked';
  }
  if (tasks.some((task) => task.status === 'blocked_by_approval')) {
    return 'approval';
  }
  return 'idle';
}

export function getRequirementId(task: BoardTask): string {
  const requirementId = task.extras.requirement_id?.trim();
  if (requirementId) {
    return requirementId;
  }
  const flowId = task.extras.flow_id?.trim();
  if (flowId) {
    return flowId;
  }
  const plannerSessionKey = task.extras.planner_session_key?.trim();
  if (plannerSessionKey) {
    return plannerSessionKey;
  }
  const managerSessionKey = task.extras.manager_session_key?.trim();
  if (managerSessionKey) {
    return managerSessionKey;
  }
  return task.id;
}

export function getRequirementTitle(task: BoardTask, requirementId: string): string {
  const requirementTitle = task.extras.requirement_title?.trim();
  if (requirementTitle) {
    return requirementTitle;
  }
  const requirementText = task.extras.requirement?.trim();
  if (requirementText) {
    return requirementText;
  }
  if (task.extras.flow_id) {
    return `需求 ${requirementId.slice(0, 8)}`;
  }
  return task.title;
}

export function buildKanbanColumns(params: {
  viewMode: BoardViewMode;
  allTasks: BoardTask[];
  allAgentNames: string[];
  statusColumns: StatusColumnConfig[];
}): BoardColumn[] {
  const {
    viewMode,
    allTasks,
    allAgentNames,
    statusColumns,
  } = params;
  if (viewMode === 'status') {
    return statusColumns.map((column) => ({
      id: `status:${column.key}`,
      title: column.title,
      tasks: allTasks.filter((task) => resolveStatusColumnKey(task) === column.key),
    }));
  }

  if (viewMode === 'flow') {
    const grouped = new Map<string, BoardColumn>();
    for (const task of allTasks) {
      const requirementId = getRequirementId(task);
      if (!grouped.has(requirementId)) {
        grouped.set(requirementId, {
          id: `flow:${requirementId}`,
          title: getRequirementTitle(task, requirementId),
          flowId: requirementId,
          tasks: [],
        });
      }
      grouped.get(requirementId)?.tasks.push(task);
    }
    for (const column of grouped.values()) {
      column.flowState = resolveFlowColumnState(column.tasks);
    }
    return Array.from(grouped.values());
  }

  const grouped = new Map<string, BoardTask[]>();
  for (const agentName of allAgentNames) {
    grouped.set(agentName, []);
  }
  for (const task of allTasks) {
    const key = task.agentName || '待分配';
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)?.push(task);
  }
  return Array.from(grouped.entries()).map(([agentName, tasks]) => ({
    id: `agent:${agentName}`,
    title: agentName,
    tasks,
  }));
}
