import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAggregateOverview } from '../api/client';
import type { AggregateOverviewAgentItem, AggregateOverviewResponse } from '../api/types';
import type { BoardTask, BoardViewMode, TaskStatus } from './kanbanTypes';
import { readFlowTasks, writeFlowTasks } from '../state/flowTaskStore';

const STATUS_COLUMNS: Array<{ key: TaskStatus; title: string }> = [
  { key: 'queued', title: '待调度' },
  { key: 'running', title: '进行中' },
  { key: 'blocked_by_approval', title: '待审批' },
  { key: 'failed', title: '失败' },
  { key: 'completed', title: '完成' },
];

export default function CollabPage(): JSX.Element {
  const [overview, setOverview] = useState<AggregateOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<BoardViewMode>('status');
  const [flowTasks, setFlowTasks] = useState<BoardTask[]>([]);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [requirementInput, setRequirementInput] = useState('');
  const [isAddAgentModalOpen, setIsAddAgentModalOpen] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');
  const [customAgentNames, setCustomAgentNames] = useState<string[]>([]);

  const loadOverview = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const data = await getAggregateOverview();
      setOverview(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : '获取看板数据失败';
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
    setFlowTasks(readFlowTasks());
  }, [loadOverview]);

  const providerTasks = useMemo(() => deriveProviderTasks(overview), [overview]);
  const allTasks = useMemo(() => [...flowTasks, ...providerTasks], [flowTasks, providerTasks]);
  const primaryAgentNames = useMemo(() => {
    const nameSet = new Set<string>();
    for (const item of overview?.agents ?? []) {
      const name = item.agent_name.trim();
      if (name) {
        nameSet.add(name);
      }
    }
    return Array.from(nameSet);
  }, [overview?.agents]);
  const allAgentNames = useMemo(() => {
    const unique = new Set([...primaryAgentNames, ...customAgentNames]);
    return Array.from(unique);
  }, [customAgentNames, primaryAgentNames]);

  const openClawLoad = useMemo(() => getOpenClawLoad(overview), [overview]);

  const groupedColumns = useMemo(() => {
    if (viewMode === 'status') {
      const grouped = new Map<string, BoardTask[]>();
      for (const column of STATUS_COLUMNS) {
        grouped.set(column.title, allTasks.filter((task) => task.status === column.key));
      }
      return grouped;
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
    return grouped;
  }, [allTasks, allAgentNames, viewMode]);

  const canSubmitFlowTask = requirementInput.trim().length > 0;
  const canSubmitAgent = newAgentName.trim().length > 0;

  const handleConfirmCreateTask = useCallback(() => {
    const requirement = requirementInput.trim();
    if (!requirement) {
      return;
    }

    const now = Date.now();
    const newTask: BoardTask = {
      id: `flow-quick-${now}`,
      title: requirement,
      summary: '由看板快捷创建',
      status: 'queued',
      source: 'flow',
      agentId: null,
      agentName: '待分配',
      artifacts: [`创建时间：${new Date(now).toISOString()}`],
      extras: {
        created_from: 'kanban_quick_create',
      },
    };

    setFlowTasks((prev) => {
      const next = [newTask, ...prev];
      writeFlowTasks(next);
      return next;
    });
    setRequirementInput('');
    setIsCreateModalOpen(false);
  }, [requirementInput]);

  const handleConfirmCreateAgent = useCallback(() => {
    const name = newAgentName.trim();
    if (!name) {
      return;
    }
    setCustomAgentNames((prev) => (prev.includes(name) ? prev : [...prev, name]));
    setNewAgentName('');
    setIsAddAgentModalOpen(false);
  }, [newAgentName]);

  return (
    <section style={pageStyle} aria-label="kanban-workbench">
      <header style={flatToolbarStyle}>
        <div style={toolbarStatsStyle} aria-label="看板统计">
          <span style={statsItemStyle}>OpenClaw CPU {openClawLoad.cpuPercent}</span>
          <span style={statsItemStyle}>OpenClaw 内存 {openClawLoad.memoryUsage}</span>
          <span style={statsItemStyle}>今日 Token {openClawLoad.todayTokens}</span>
        </div>
        <div style={toolbarGroupStyle}>
          <button type="button" style={flatActionButtonStyle} onClick={() => setIsCreateModalOpen(true)} aria-label="新增任务">
            + 新增任务
          </button>
          <select
            id="view-mode"
            aria-label="分列方式"
            value={viewMode}
            onChange={(event) => setViewMode(event.target.value as BoardViewMode)}
            style={viewSelectStyle}
          >
            <option value="status">按状态分列</option>
            <option value="agent">按 Agent 分列</option>
          </select>
        </div>
      </header>

      {isCreateModalOpen ? (
        <div style={modalOverlayStyle} role="dialog" aria-modal="true" aria-label="创建 flow 任务">
          <div style={modalCardStyle}>
            <h3 style={modalTitleStyle}>新增 flow 任务</h3>
            <label htmlFor="quick-flow-requirement" style={modalLabelStyle}>
              需求
            </label>
            <textarea
              id="quick-flow-requirement"
              value={requirementInput}
              onChange={(event) => setRequirementInput(event.target.value)}
              placeholder="请输入需求"
              style={modalInputStyle}
            />
            <div style={modalActionStyle}>
              <button
                type="button"
                style={flatActionButtonStyle}
                onClick={handleConfirmCreateTask}
                disabled={!canSubmitFlowTask}
              >
                确定
              </button>
              <button
                type="button"
                style={flatActionButtonStyle}
                onClick={() => {
                  setIsCreateModalOpen(false);
                  setRequirementInput('');
                }}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isAddAgentModalOpen ? (
        <div style={modalOverlayStyle} role="dialog" aria-modal="true" aria-label="新增 Agent">
          <div style={modalCardStyle}>
            <h3 style={modalTitleStyle}>新增 Agent</h3>
            <label htmlFor="new-agent-name" style={modalLabelStyle}>
              Agent 名称
            </label>
            <input
              id="new-agent-name"
              type="text"
              value={newAgentName}
              onChange={(event) => setNewAgentName(event.target.value)}
              placeholder="请输入 Agent 名称"
              style={modalInputTextStyle}
            />
            <div style={modalActionStyle}>
              <button type="button" style={flatActionButtonStyle} onClick={handleConfirmCreateAgent} disabled={!canSubmitAgent}>
                确定
              </button>
              <button
                type="button"
                style={flatActionButtonStyle}
                onClick={() => {
                  setIsAddAgentModalOpen(false);
                  setNewAgentName('');
                }}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {loadError ? (
        <div style={errorPanelStyle}>
          <p style={errorTitleStyle}>看板数据加载失败</p>
          <p style={errorMessageStyle}>{loadError}</p>
        </div>
      ) : null}

      <div style={boardViewportStyle} data-testid="kanban-board">
        <div style={boardTrackStyle}>
          {Array.from(groupedColumns.entries()).map(([columnName, tasks]) => (
            <article key={columnName} style={columnStyle}>
              <header style={columnHeaderStyle}>
                <h3 style={columnTitleStyle}>{columnName}</h3>
                <span style={columnCountStyle}>{tasks.length}</span>
              </header>
              <div style={columnBodyStyle}>
                {loading ? (
                  <p style={emptyTextStyle}>同步中...</p>
                ) : tasks.length === 0 ? (
                  <p style={emptyTextStyle}>暂无任务</p>
                ) : (
                  tasks.map((task) => (
                    <article key={task.id} style={taskCardStyle}>
                      <div style={taskCardHeaderStyle}>
                        <span style={taskSourceTagStyle}>{task.source === 'flow' ? 'Flow' : 'Provider'}</span>
                        <span style={taskStatusTextStyle}>{task.status}</span>
                      </div>
                      <h4 style={taskTitleStyle}>{task.title}</h4>
                      <p style={taskSummaryStyle}>{task.summary}</p>
                      <p style={taskMetaStyle}>Agent：{task.agentName}</p>
                      {task.artifacts.length > 0 ? (
                        <p style={taskArtifactStyle}>{task.artifacts[0]}</p>
                      ) : null}
                    </article>
                  ))
                )}
              </div>
            </article>
          ))}

          {viewMode === 'agent' ? (
            <article style={addAgentColumnStyle}>
              <header style={columnHeaderStyle}>
                <h3 style={columnTitleStyle}>新增 Agent</h3>
                <button
                  type="button"
                  style={addAgentHeaderButtonStyle}
                  aria-label="打开新增 Agent"
                  onClick={() => setIsAddAgentModalOpen(true)}
                >
                  + 新增
                </button>
              </header>
              <div style={addAgentBodyStyle}>
                <p style={emptyTextStyle}>创建主 Agent 列，后续任务可直接投放。</p>
              </div>
            </article>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function deriveProviderTasks(overview: AggregateOverviewResponse | null): BoardTask[] {
  const agents = overview?.agents ?? [];

  return agents.map((agent) => {
    const status = toBoardStatus(agent);
    return {
      id: `provider-${agent.instance_id}-${agent.agent_id}`,
      title: agent.agent_name,
      summary: `来自聚合数据的实时任务映射（实例：${agent.instance_name}）`,
      status,
      source: 'provider',
      agentId: agent.agent_id,
      agentName: agent.agent_name,
      artifacts: [
        `drilldown: ${agent.drilldown_path}`,
        `last_active_at: ${agent.last_active_at ?? 'n/a'}`,
      ],
      extras: {
        instance_id: agent.instance_id,
        instance_name: agent.instance_name,
      },
    };
  });
}

function toBoardStatus(agent: AggregateOverviewAgentItem): TaskStatus {
  if (agent.status === 'error') return 'failed';
  if (agent.status === 'finished') return 'completed';
  if (agent.status === 'running' && agent.is_active) return 'running';
  return 'queued';
}

function getOpenClawLoad(overview: AggregateOverviewResponse | null): {
  cpuPercent: string;
  memoryUsage: string;
  todayTokens: string;
} {
  if (!overview) {
    return {
      cpuPercent: '--',
      memoryUsage: '--',
      todayTokens: '--',
    };
  }

  const overviewUnknown = overview as unknown as Record<string, unknown>;
  const statsUnknown = overview.stats as unknown as Record<string, unknown>;

  const cpu = findFirstNumber([
    statsUnknown.cpu_percent,
    statsUnknown.cpu_usage,
    statsUnknown.openclaw_cpu_percent,
    overviewUnknown.cpu_percent,
    overviewUnknown.cpu_usage,
  ]);

  const memoryMb = findFirstNumber([
    statsUnknown.memory_mb,
    statsUnknown.memory_usage_mb,
    statsUnknown.openclaw_memory_mb,
    overviewUnknown.memory_mb,
    overviewUnknown.memory_usage_mb,
  ]);

  const todayTokens = findFirstNumber([
    statsUnknown.today_tokens,
    statsUnknown.daily_tokens,
    statsUnknown.token_today,
    statsUnknown.total_tokens,
    overview.stats.total_tokens,
  ]);

  return {
    cpuPercent: cpu === null ? '--' : `${cpu.toFixed(1)}%`,
    memoryUsage: memoryMb === null ? '--' : `${Math.round(memoryMb)} MB`,
    todayTokens: todayTokens === null ? '--' : todayTokens.toLocaleString('zh-CN'),
  };
}

function findFirstNumber(values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

const pageStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.8rem',
};

const flatToolbarStyle: React.CSSProperties = {
  border: '1px solid rgba(15, 23, 42, 0.12)',
  borderRadius: '0.4rem',
  background: 'rgba(255, 255, 255, 0.86)',
  padding: '0.55rem 0.65rem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.65rem',
};

const toolbarGroupStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
};

const toolbarStatsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.4rem',
  flexWrap: 'wrap',
};

const statsItemStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.35)',
  background: 'rgba(248, 250, 252, 0.9)',
  color: '#334155',
  borderRadius: '0.35rem',
  padding: '0.22rem 0.5rem',
  fontSize: '0.76rem',
  fontWeight: 600,
};

const flatActionButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(15, 23, 42, 0.22)',
  background: 'rgba(255, 255, 255, 0.9)',
  color: '#1f2937',
  borderRadius: '0.35rem',
  padding: '0.4rem 0.68rem',
  fontSize: '0.8rem',
  fontWeight: 600,
  cursor: 'pointer',
};

const modalLabelStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  color: '#334155',
  fontWeight: 600,
};

const viewSelectStyle: React.CSSProperties = {
  border: '1px solid rgba(15, 23, 42, 0.22)',
  borderRadius: '0.35rem',
  padding: '0.35rem 0.45rem',
  fontSize: '0.8rem',
  background: 'rgba(255, 255, 255, 0.95)',
};

const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 40,
};

const modalCardStyle: React.CSSProperties = {
  width: 'min(520px, calc(100vw - 2rem))',
  borderRadius: '0.65rem',
  background: '#fff',
  border: '1px solid rgba(15, 23, 42, 0.2)',
  padding: '0.9rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.55rem',
};

const modalTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.95rem',
  fontWeight: 700,
  color: '#0f172a',
};

const modalInputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: '7rem',
  border: '1px solid rgba(15, 23, 42, 0.2)',
  borderRadius: '0.5rem',
  padding: '0.55rem 0.65rem',
  fontSize: '0.85rem',
  resize: 'vertical',
};

const modalInputTextStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid rgba(15, 23, 42, 0.2)',
  borderRadius: '0.5rem',
  padding: '0.55rem 0.65rem',
  fontSize: '0.85rem',
};

const modalActionStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0.45rem',
  justifyContent: 'flex-end',
};

const boardViewportStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowX: 'auto',
  overflowY: 'hidden',
};

const boardTrackStyle: React.CSSProperties = {
  height: '100%',
  minWidth: 'max-content',
  display: 'flex',
  gap: '0.65rem',
};

const columnStyle: React.CSSProperties = {
  width: '420px',
  flex: '0 0 420px',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  borderRadius: '0.65rem',
  border: '1px solid rgba(15, 23, 42, 0.12)',
  background: 'rgba(255, 255, 255, 0.84)',
};

const addAgentColumnStyle: React.CSSProperties = {
  ...columnStyle,
  borderStyle: 'dashed',
  borderColor: 'rgba(14, 116, 144, 0.35)',
  background: 'rgba(240, 249, 255, 0.78)',
};

const columnHeaderStyle: React.CSSProperties = {
  padding: '0.58rem 0.65rem',
  borderBottom: '1px solid rgba(148, 163, 184, 0.26)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const columnTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.84rem',
  fontWeight: 700,
};

const columnCountStyle: React.CSSProperties = {
  minWidth: '1.45rem',
  height: '1.45rem',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '999px',
  background: 'rgba(15, 118, 110, 0.1)',
  color: '#0f766e',
  fontSize: '0.74rem',
  fontWeight: 700,
};

const columnBodyStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.48rem',
  padding: '0.58rem',
};

const addAgentBodyStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  padding: '0.58rem',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  alignItems: 'flex-start',
  gap: '0.55rem',
};

const addAgentHeaderButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(14, 116, 144, 0.35)',
  background: 'rgba(240, 249, 255, 0.95)',
  color: '#0c4a6e',
  borderRadius: '0.35rem',
  padding: '0.2rem 0.5rem',
  fontSize: '0.72rem',
  fontWeight: 700,
  cursor: 'pointer',
};

const taskCardStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.28)',
  background: 'rgba(255, 255, 255, 0.94)',
  borderRadius: '0.55rem',
  padding: '0.55rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.32rem',
};

const taskCardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const taskSourceTagStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: '999px',
  background: 'rgba(14, 116, 144, 0.12)',
  color: '#155e75',
  fontSize: '0.68rem',
  padding: '0.12rem 0.45rem',
  fontWeight: 700,
};

const taskStatusTextStyle: React.CSSProperties = {
  fontSize: '0.7rem',
  color: '#334155',
  fontWeight: 600,
};

const taskTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.83rem',
  fontWeight: 700,
};

const taskSummaryStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.74rem',
  color: '#475569',
  lineHeight: 1.35,
};

const taskMetaStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.71rem',
  color: '#64748b',
};

const taskArtifactStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.7rem',
  color: '#334155',
  borderTop: '1px dashed rgba(148, 163, 184, 0.35)',
  paddingTop: '0.3rem',
};

const errorPanelStyle: React.CSSProperties = {
  borderRadius: '0.55rem',
  border: '1px solid rgba(220, 38, 38, 0.35)',
  background: 'rgba(254, 242, 242, 0.86)',
  color: '#991b1b',
  padding: '0.55rem 0.65rem',
};

const errorTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  fontWeight: 700,
};

const errorMessageStyle: React.CSSProperties = {
  margin: '0.2rem 0 0 0',
  fontSize: '0.74rem',
};

const emptyTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.75rem',
  color: '#64748b',
};
