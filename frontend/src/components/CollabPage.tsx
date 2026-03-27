import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createKanbanTask, getAggregateOverview, listKanbanTasks } from '../api/client';
import type {
  AggregateOverviewResponse,
  KanbanTaskItem,
} from '../api/types';
import type { BoardTask, BoardViewMode, TaskStatus } from './kanbanTypes';
import { readFlowTasks } from '../state/flowTaskStore';
import { useIsMobile } from '../hooks/useIsMobile';
import { useToast } from '../hooks/useToast';

const STATUS_COLUMNS: Array<{ key: TaskStatus; title: string }> = [
  { key: 'queued', title: '待调度' },
  { key: 'running', title: '进行中' },
  { key: 'blocked_by_approval', title: '待审批' },
  { key: 'failed', title: '失败' },
  { key: 'completed', title: '完成' },
];

export default function CollabPage(): JSX.Element {
  const navigate = useNavigate();
  const isMobile = useIsMobile(960);
  const { addToast } = useToast();
  const [overview, setOverview] = useState<AggregateOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [taskRecords, setTaskRecords] = useState<BoardTask[]>([]);

  const [viewMode, setViewMode] = useState<BoardViewMode>('status');
  const [flowTasks, setFlowTasks] = useState<BoardTask[]>([]);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [requirementInput, setRequirementInput] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [isAddAgentModalOpen, setIsAddAgentModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<BoardTask | null>(null);
  const [newAgentName, setNewAgentName] = useState('');
  const [customAgentNames, setCustomAgentNames] = useState<string[]>([]);

  const loadOverview = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const [data, tasks] = await Promise.all([getAggregateOverview(), listKanbanTasks()]);
      setOverview(data);
      setTaskRecords(tasks.map(toBoardTaskFromKanbanTask));
      setSelectedAgentId((current) => {
        if (current && data.agents.some((agent) => agent.agent_id === current)) {
          return current;
        }
        return data.agents[0]?.agent_id ?? '';
      });
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

  const allTasks = useMemo(() => [...flowTasks, ...taskRecords], [flowTasks, taskRecords]);
  const assignableAgents = useMemo(
    () =>
      (overview?.agents ?? []).filter(
        (agent, index, source) => source.findIndex((item) => item.agent_id === agent.agent_id) === index
      ),
    [overview?.agents]
  );
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

  const canSubmitFlowTask = requirementInput.trim().length > 0 && selectedAgentId.trim().length > 0;
  const canSubmitAgent = newAgentName.trim().length > 0;

  const handleConfirmCreateTask = useCallback(async () => {
    const requirement = requirementInput.trim();
    const targetAgent = assignableAgents.find((agent) => agent.agent_id === selectedAgentId);
    if (!requirement || !targetAgent) {
      return;
    }

    try {
      await createKanbanTask(
        {
          requirement,
          agent_id: targetAgent.agent_id,
          agent_name: targetAgent.agent_name,
          instance_id: targetAgent.instance_id,
        },
        { instanceId: targetAgent.instance_id }
      );
      setRequirementInput('');
      setIsCreateModalOpen(false);
      addToast(`已投放到 ${targetAgent.agent_name}`, 'success');
      await loadOverview();
    } catch (error) {
      const message = error instanceof Error ? error.message : '新增任务投放失败';
      addToast(message, 'error');
    }
  }, [addToast, assignableAgents, loadOverview, requirementInput, selectedAgentId]);

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
          <button
            type="button"
            style={flatActionButtonStyle}
            onClick={() => {
              setIsCreateModalOpen(true);
              setSelectedAgentId((current) => current || assignableAgents[0]?.agent_id || '');
            }}
            aria-label="新增任务"
          >
            + 新增任务
          </button>
          <button
            type="button"
            style={flatActionButtonStyle}
            onClick={() => navigate('/flow')}
            aria-label="创建流程"
          >
            创建流程
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
            <h3 style={modalTitleStyle}>新增任务</h3>
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
            <label htmlFor="quick-flow-agent" style={modalLabelStyle}>
              指派 Agent
            </label>
            <select
              id="quick-flow-agent"
              value={selectedAgentId}
              onChange={(event) => setSelectedAgentId(event.target.value)}
              style={modalSelectStyle}
              disabled={assignableAgents.length === 0}
            >
              <option value="" disabled>
                {assignableAgents.length === 0 ? '暂无可用 Agent' : '请选择 Agent'}
              </option>
              {assignableAgents.map((agent) => (
                <option key={agent.agent_id} value={agent.agent_id}>
                  {agent.agent_name}
                </option>
              ))}
            </select>
            <div style={modalActionStyle}>
              <button
                type="button"
                style={flatActionButtonStyle}
                onClick={() => void handleConfirmCreateTask()}
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

      {selectedTask ? (
        <div style={modalOverlayStyle} role="dialog" aria-modal="true" aria-label="任务详情">
          <div style={taskDetailCardStyle}>
            <h3 style={modalTitleStyle}>任务详情</h3>
            <p style={taskDetailTitleStyle}>{selectedTask.title}</p>
            <div style={taskDetailMetaGridStyle}>
              <p style={taskDetailMetaTextStyle}>状态：{selectedTask.status}</p>
              <p style={taskDetailMetaTextStyle}>来源：{selectedTask.source === 'flow' ? 'Flow' : 'Provider'}</p>
              <p style={taskDetailMetaTextStyle}>Agent：{selectedTask.agentName || '待分配'}</p>
              <p style={taskDetailMetaTextStyle}>Agent ID：{selectedTask.agentId ?? 'n/a'}</p>
            </div>
            <div style={taskDetailSectionStyle}>
              <p style={taskDetailSectionTitleStyle}>摘要</p>
              <p style={taskDetailSummaryStyle}>{selectedTask.summary || '暂无摘要'}</p>
            </div>
            <div style={taskDetailSectionStyle}>
              <p style={taskDetailSectionTitleStyle}>产出</p>
              {selectedTask.artifacts.length > 0 ? (
                <ul style={taskDetailListStyle}>
                  {selectedTask.artifacts.map((artifact, index) => (
                    <li key={`${selectedTask.id}-artifact-${index}`} style={taskDetailListItemStyle}>
                      {artifact}
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={taskDetailSummaryStyle}>暂无产出</p>
              )}
            </div>
            <div style={taskDetailSectionStyle}>
              <p style={taskDetailSectionTitleStyle}>扩展字段</p>
              {Object.keys(selectedTask.extras).length > 0 ? (
                <ul style={taskDetailListStyle}>
                  {Object.entries(selectedTask.extras).map(([key, value]) => (
                    <li key={`${selectedTask.id}-extra-${key}`} style={taskDetailListItemStyle}>
                      <span style={taskDetailExtraKeyStyle}>{key}：</span>
                      <span style={taskDetailExtraValueStyle}>{value}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={taskDetailSummaryStyle}>暂无扩展字段</p>
              )}
            </div>
            <div style={modalActionStyle}>
              <button type="button" style={flatActionButtonStyle} onClick={() => setSelectedTask(null)}>
                关闭
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

      <div style={isMobile ? mobileBoardViewportStyle : boardViewportStyle} data-testid="kanban-board">
        <div style={isMobile ? mobileBoardTrackStyle : boardTrackStyle}>
          {Array.from(groupedColumns.entries()).map(([columnName, tasks]) => (
            <article key={columnName} style={isMobile ? mobileColumnStyle : columnStyle}>
              <header style={columnHeaderStyle}>
                <h3 style={columnTitleStyle}>{columnName}</h3>
                <span style={columnCountStyle}>{tasks.length}</span>
              </header>
              <div style={isMobile ? mobileColumnBodyStyle : columnBodyStyle}>
                {loading ? (
                  <p style={emptyTextStyle}>同步中...</p>
                ) : tasks.length === 0 ? (
                  <p style={emptyTextStyle}>暂无任务</p>
                ) : (
                  tasks.map((task) => (
                    <article key={task.id} style={taskCardStyle}>
                      <button
                        type="button"
                        style={taskCardButtonStyle}
                        onClick={() => setSelectedTask(task)}
                        aria-label={`查看任务 ${task.title}`}
                      >
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
                      </button>
                    </article>
                  ))
                )}
              </div>
            </article>
          ))}

          {viewMode === 'agent' ? (
            <article style={isMobile ? mobileAddAgentColumnStyle : addAgentColumnStyle}>
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
              <div style={isMobile ? mobileAddAgentBodyStyle : addAgentBodyStyle}>
                <p style={addAgentHintStyle}>创建主 Agent 列，后续任务可直接投放。</p>
              </div>
            </article>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function toBoardTaskFromKanbanTask(task: KanbanTaskItem): BoardTask {
  return {
    id: task.id,
    title: task.title,
    summary: task.summary,
    status: normalizeTaskStatus(task.status),
    source: task.source === 'provider' ? 'provider' : 'flow',
    agentId: task.agent_id,
    agentName: task.agent_name || '待分配',
    artifacts: task.artifacts,
    extras: task.extras,
  };
}

function normalizeTaskStatus(status: string): TaskStatus {
  if (status === 'running') return 'running';
  if (status === 'blocked_by_approval') return 'blocked_by_approval';
  if (status === 'failed') return 'failed';
  if (status === 'completed') return 'completed';
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
  width: '100%',
  minWidth: 0,
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.8rem',
  background: 'transparent',
};

const flatToolbarStyle: React.CSSProperties = {
  border: '1px solid rgba(15, 23, 42, 0.1)',
  borderRadius: '0.4rem',
  background: 'rgba(255, 255, 255, 0.44)',
  backdropFilter: 'blur(8px)',
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
  background: 'rgba(255, 255, 255, 0.6)',
  color: '#334155',
  borderRadius: '0.35rem',
  padding: '0.22rem 0.5rem',
  fontSize: '0.76rem',
  fontWeight: 600,
};

const flatActionButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(15, 23, 42, 0.16)',
  background: 'rgba(255, 255, 255, 0.72)',
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
  border: '1px solid rgba(15, 23, 42, 0.16)',
  borderRadius: '0.35rem',
  padding: '0.35rem 0.45rem',
  fontSize: '0.8rem',
  background: 'rgba(255, 255, 255, 0.72)',
};

const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 140,
};

const modalCardStyle: React.CSSProperties = {
  width: 'min(520px, calc(100vw - 2rem))',
  borderRadius: '0.65rem',
  background: 'rgba(255, 255, 255, 0.95)',
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

const modalSelectStyle: React.CSSProperties = {
  ...modalInputTextStyle,
  background: 'rgba(255, 255, 255, 0.92)',
};

const modalActionStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0.45rem',
  justifyContent: 'flex-end',
};

const taskDetailCardStyle: React.CSSProperties = {
  ...modalCardStyle,
  width: 'min(680px, calc(100vw - 2rem))',
  maxHeight: 'calc(100vh - 3rem)',
  overflowY: 'auto',
};

const taskDetailTitleStyle: React.CSSProperties = {
  margin: '0',
  fontSize: '0.98rem',
  fontWeight: 700,
  color: '#0f172a',
};

const taskDetailMetaGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: '0.35rem 0.65rem',
  padding: '0.5rem',
  borderRadius: '0.5rem',
  border: '1px solid rgba(148, 163, 184, 0.25)',
  background: 'rgba(248, 250, 252, 0.82)',
};

const taskDetailMetaTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.76rem',
  color: '#334155',
};

const taskDetailSectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.35rem',
};

const taskDetailSectionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  fontWeight: 700,
  color: '#1e293b',
};

const taskDetailSummaryStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.76rem',
  color: '#475569',
  lineHeight: 1.45,
};

const taskDetailListStyle: React.CSSProperties = {
  margin: 0,
  paddingInlineStart: '1.05rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.24rem',
};

const taskDetailListItemStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: '#334155',
  lineHeight: 1.4,
};

const taskDetailExtraKeyStyle: React.CSSProperties = {
  fontWeight: 700,
  color: '#0f172a',
};

const taskDetailExtraValueStyle: React.CSSProperties = {
  color: '#334155',
};

const boardViewportStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
  flex: 1,
  minHeight: 0,
  overflowX: 'auto',
  overflowY: 'hidden',
  overscrollBehaviorX: 'contain',
};

const mobileBoardViewportStyle: React.CSSProperties = {
  ...boardViewportStyle,
  overflowX: 'auto',
  overflowY: 'auto',
  WebkitOverflowScrolling: 'touch',
  touchAction: 'pan-x',
  overscrollBehavior: 'contain',
};

const boardTrackStyle: React.CSSProperties = {
  height: '100%',
  minWidth: 'max-content',
  display: 'flex',
  gap: '0.65rem',
};

const mobileBoardTrackStyle: React.CSSProperties = {
  ...boardTrackStyle,
  height: 'auto',
  alignItems: 'flex-start',
  paddingBottom: '0.25rem',
  paddingRight: '0.25rem',
};

const columnStyle: React.CSSProperties = {
  width: '420px',
  flex: '0 0 420px',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  borderRadius: '0.65rem',
  border: '1px solid rgba(15, 23, 42, 0.1)',
  background: 'linear-gradient(160deg, rgba(255, 255, 255, 0.62) 0%, rgba(240, 253, 250, 0.42) 100%)',
  backdropFilter: 'blur(6px)',
};

const mobileColumnStyle: React.CSSProperties = {
  ...columnStyle,
  width: '86vw',
  minWidth: '320px',
  maxWidth: '560px',
  flex: '0 0 86vw',
  minHeight: 'auto',
  alignSelf: 'flex-start',
};

const addAgentColumnStyle: React.CSSProperties = {
  ...columnStyle,
  borderStyle: 'dashed',
  borderColor: 'rgba(14, 116, 144, 0.35)',
  background: 'linear-gradient(155deg, rgba(224, 242, 254, 0.5) 0%, rgba(236, 253, 245, 0.45) 100%)',
};

const mobileAddAgentColumnStyle: React.CSSProperties = {
  ...mobileColumnStyle,
  borderStyle: 'dashed',
  borderColor: 'rgba(14, 116, 144, 0.35)',
  background: 'linear-gradient(155deg, rgba(224, 242, 254, 0.5) 0%, rgba(236, 253, 245, 0.45) 100%)',
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

const mobileColumnBodyStyle: React.CSSProperties = {
  ...columnBodyStyle,
  overflowY: 'visible',
  minHeight: 'auto',
  flex: '0 0 auto',
};

const addAgentBodyStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  padding: '0.58rem',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-start',
  alignItems: 'center',
  gap: '0.55rem',
};

const mobileAddAgentBodyStyle: React.CSSProperties = {
  ...addAgentBodyStyle,
  minHeight: 'auto',
  paddingBottom: '0.9rem',
};

const addAgentHintStyle: React.CSSProperties = {
  margin: '0.4rem 0 0',
  fontSize: '0.75rem',
  color: '#64748b',
  textAlign: 'center',
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
  background: 'rgba(255, 255, 255, 0.76)',
  borderRadius: '0.55rem',
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
};

const taskCardButtonStyle: React.CSSProperties = {
  width: '100%',
  border: 'none',
  background: 'transparent',
  borderRadius: '0.55rem',
  padding: '0.55rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.32rem',
  textAlign: 'left',
  cursor: 'pointer',
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
