import type { BoardTask, TaskStatus, TaskSource } from '../components/kanbanTypes';

const FLOW_TASK_STORAGE_KEY = 'linpo.v07.flow_tasks';

function isTaskStatus(value: unknown): value is TaskStatus {
  return (
    value === 'queued'
    || value === 'running'
    || value === 'blocked_by_approval'
    || value === 'failed'
    || value === 'completed'
  );
}

function isTaskSource(value: unknown): value is TaskSource {
  return value === 'provider' || value === 'flow';
}

function isBoardTask(value: unknown): value is BoardTask {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<BoardTask>;
  return (
    typeof candidate.id === 'string'
    && typeof candidate.title === 'string'
    && typeof candidate.summary === 'string'
    && isTaskStatus(candidate.status)
    && isTaskSource(candidate.source)
    && (typeof candidate.agentId === 'string' || candidate.agentId === null)
    && typeof candidate.agentName === 'string'
    && Array.isArray(candidate.artifacts)
    && typeof candidate.extras === 'object'
    && candidate.extras !== null
  );
}

export function readFlowTasks(): BoardTask[] {
  if (typeof window === 'undefined') {
    return [];
  }

  const raw = window.localStorage.getItem(FLOW_TASK_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isBoardTask);
  } catch {
    return [];
  }
}

export function writeFlowTasks(tasks: BoardTask[]): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(FLOW_TASK_STORAGE_KEY, JSON.stringify(tasks));
}

export function appendFlowTasks(tasks: BoardTask[]): void {
  if (tasks.length === 0) {
    return;
  }
  const existing = readFlowTasks();
  writeFlowTasks([...tasks, ...existing]);
}

export function clearFlowTasks(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.removeItem(FLOW_TASK_STORAGE_KEY);
}
