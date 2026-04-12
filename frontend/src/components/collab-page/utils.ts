import type {
  AggregateOverviewAgentItem,
  FlowCanvasEdge,
  FlowCanvasNode,
  KanbanTaskItem,
} from '../../api/types';
import type { BoardTask, TaskStatus } from '../kanbanTypes';
import { resolveStatusColumnKey, type FlowColumnState } from '../collabKanbanColumnsUtils';
import { getCompactLabel } from '../collabTaskPreviewUtils';
import type { TaskOutputEntry } from '../collabTaskDetailModal';

export type StatusColumnKey = 'pending_confirmation' | TaskStatus | 'blocked';

export const STATUS_COLUMNS: Array<{ key: StatusColumnKey; title: string }> = [
  { key: 'pending_confirmation', title: '待确认' },
  { key: 'queued', title: '待调度' },
  { key: 'running', title: '进行中' },
  { key: 'blocked', title: '阻塞' },
  { key: 'blocked_by_approval', title: '待审批' },
  { key: 'failed', title: '失败' },
  { key: 'completed', title: '完成' },
];

export type AssignableAgent = {
  key: string;
  agentId: string;
  agentName: string;
  instanceId: string;
  instanceName: string;
};

export function toBoardTaskFromKanbanTask(task: KanbanTaskItem): BoardTask {
  return {
    id: task.id,
    title: task.title,
    summary: task.summary,
    status: normalizeTaskStatus(task.status),
    source: task.source === 'provider' ? 'provider' : 'flow',
    instanceId: task.instance_id,
    agentId: task.agent_id,
    agentName: task.agent_name || '待分配',
    artifacts: task.artifacts,
    extras: task.extras,
  };
}

export function formatTaskAgentLabel(task: BoardTask): string {
  const agentName = task.agentName?.trim() || task.agentId?.trim() || '待分配';
  const instanceId = task.instanceId?.trim() ?? '';
  if (!instanceId) {
    return agentName;
  }
  return `${instanceId} / ${agentName}`;
}

export function getTaskRequirementIdForCard(task: BoardTask): string {
  const requirementId = (task.extras.requirement_id ?? '').trim();
  return requirementId || '-';
}

export function normalizeTaskStatus(status: string): TaskStatus {
  if (status === 'running') return 'running';
  if (status === 'blocked_by_approval') return 'blocked_by_approval';
  if (status === 'failed') return 'failed';
  if (status === 'completed') return 'completed';
  return 'queued';
}

export function parseDependencyNodeIds(raw: string | null | undefined): string[] {
  const value = (raw ?? '').trim();
  if (value === '' || value === 'none') {
    return [];
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

export function parseFlowLayer(raw: string | undefined): number {
  const normalized = (raw ?? '').trim();
  if (!normalized) {
    return 1;
  }
  const matched = normalized.match(/^L(\d+)$/i);
  if (matched) {
    const parsed = Number.parseInt(matched[1] ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function getFlowNodeIdForTask(task: BoardTask): string {
  const fromExtras = task.extras.flow_node?.trim();
  if (fromExtras) {
    return fromExtras;
  }
  return task.id;
}

export function buildFlowConfirmPayloadFromBoardTasks({
  requirementId,
  requirementTitle,
  tasks,
  agents,
}: {
  requirementId: string;
  requirementTitle: string;
  tasks: BoardTask[];
  agents: AggregateOverviewAgentItem[];
}) {
  if (tasks.length === 0) {
    return null;
  }

  const candidateAgent = tasks
    .map((task) => {
      const taskAgentId = task.agentId?.trim() ?? '';
      const taskInstanceId = task.instanceId?.trim() ?? '';
      if (!taskAgentId || !taskInstanceId) {
        return null;
      }
      return (
        agents.find((agent) => agent.agent_id.trim() === taskAgentId && agent.instance_id.trim() === taskInstanceId)
        ?? null
      );
    })
    .find((agent): agent is AggregateOverviewAgentItem => agent !== null);
  if (!candidateAgent) {
    return null;
  }

  const nodeIds = new Set(tasks.map((task) => getFlowNodeIdForTask(task)));
  const nodes: FlowCanvasNode[] = tasks.map((task, index) => {
    const nodeId = getFlowNodeIdForTask(task);
    const layer = parseFlowLayer(task.extras.layer);
    const dependencies = parseDependencyNodeIds(task.extras.dependencies).filter(
      (dependency) => dependency !== nodeId && nodeIds.has(dependency)
    );
    return {
      id: nodeId,
      title: task.title,
      description: task.extras.flow_node_description?.trim() || task.summary,
      depends_on: dependencies,
      x: 48 + (layer - 1) * 180,
      y: 48 + index * 132,
      layer,
      sensitive: String(task.extras.sensitive ?? '').trim().toLowerCase() === 'true',
      status: 'queued',
      agent_id: task.agentId?.trim() || candidateAgent.agent_id.trim(),
    };
  });
  const edges: FlowCanvasEdge[] = nodes.flatMap((node) =>
    node.depends_on.map((dependency) => ({
      id: `edge-${dependency}-${node.id}`,
      source: dependency,
      target: node.id,
    }))
  );

  return {
    instance_id: candidateAgent.instance_id.trim(),
    requirement_id: requirementId,
    executor_agent_id: candidateAgent.agent_id.trim(),
    manager_agent_id: candidateAgent.agent_id.trim(),
    requirement_title: requirementTitle.trim() || null,
    planner_session_key: tasks[0]?.extras.planner_session_key?.trim() || null,
    execution_session_prefix: tasks[0]?.extras.execution_session_key?.trim()
      ? tasks[0].extras.execution_session_key.trim().split(':').slice(0, -1).join(':')
      : null,
    nodes,
    edges,
  };
}

export function getTaskStatusLabelForDetail(task: BoardTask): string {
  const key = resolveStatusColumnKey(task);
  const matched = STATUS_COLUMNS.find((item) => item.key === key);
  return matched?.title ?? task.status;
}

export function getFlowColumnStateLabel(state: FlowColumnState): string {
  if (state === 'running') return '运行中';
  if (state === 'blocked') return '阻塞中';
  if (state === 'approval') return '待审批';
  return '已结束';
}

function extractOutputPathFromArtifact(text: string): string | null {
  const normalized = text.trim();
  if (!normalized) {
    return null;
  }
  if (!normalized.toLowerCase().startsWith('artifact:')) {
    return null;
  }
  const value = normalized.split(':', 2)[1]?.trim() ?? '';
  return value.startsWith('/') ? value : null;
}

export function buildTaskOutputEntries(task: BoardTask): TaskOutputEntry[] {
  const entries: TaskOutputEntry[] = [];
  const seenFile = new Set<string>();

  task.artifacts.forEach((artifact) => {
    const path = extractOutputPathFromArtifact(artifact);
    if (path && !seenFile.has(path)) {
      seenFile.add(path);
      entries.push({
        id: `file:${path}`,
        title: `产出文件 · ${getCompactLabel(path, 32)}`,
        value: path,
      });
    }
  });

  return entries;
}
