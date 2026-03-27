export type BoardViewMode = 'status' | 'agent';

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'blocked_by_approval'
  | 'failed'
  | 'completed';

export type TaskSource = 'provider' | 'flow';

export interface BoardTask {
  id: string;
  title: string;
  summary: string;
  status: TaskStatus;
  source: TaskSource;
  agentId: string | null;
  agentName: string;
  artifacts: string[];
  extras: Record<string, string>;
}
