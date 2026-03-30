import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createKanbanTask,
  deleteKanbanRequirementTasks,
  deleteKanbanTask,
  getAggregateOverview,
  listKanbanTasks,
} from '../api/client';
import type {
  AggregateOverviewResponse,
  KanbanTaskItem,
} from '../api/types';
import type { BoardTask, BoardViewMode, TaskStatus } from './kanbanTypes';
import { useIsMobile } from '../hooks/useIsMobile';
import { useToast } from '../hooks/useToast';

const STATUS_COLUMNS: Array<{ key: TaskStatus; title: string }> = [
  { key: 'queued', title: '待调度' },
  { key: 'running', title: '进行中' },
  { key: 'blocked_by_approval', title: '待审批' },
  { key: 'failed', title: '失败' },
  { key: 'completed', title: '完成' },
];
type AssignableAgent = {
  key: string;
  agentId: string;
  agentName: string;
  instanceId: string;
  instanceName: string;
};

type BoardColumn = {
  id: string;
  title: string;
  tasks: BoardTask[];
  requirementId?: string;
};

export default function CollabPage(): JSX.Element {
  const navigate = useNavigate();
  const isMobile = useIsMobile(960);
  const { addToast } = useToast();
  const [overview, setOverview] = useState<AggregateOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [taskRecords, setTaskRecords] = useState<BoardTask[]>([]);

  const [viewMode, setViewMode] = useState<BoardViewMode>('status');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [requirementInput, setRequirementInput] = useState('');
  const [selectedAgentKey, setSelectedAgentKey] = useState('');
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
    } catch (error) {
      const message = error instanceof Error ? error.message : '获取看板数据失败';
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const allTasks = useMemo(() => taskRecords, [taskRecords]);
  const assignableAgents = useMemo<AssignableAgent[]>(() => {
    const agentsByKey = new Map<string, AssignableAgent>();
    for (const item of overview?.agents ?? []) {
      const agentId = item.agent_id.trim();
      const instanceId = item.instance_id.trim();
      if (!agentId || !instanceId) {
        continue;
      }
      const key = `${instanceId}::${agentId}`;
      if (agentsByKey.has(key)) {
        continue;
      }
      agentsByKey.set(key, {
        key,
        agentId,
        agentName: item.agent_name.trim() || agentId,
        instanceId,
        instanceName: item.instance_name.trim() || instanceId,
      });
    }
    return Array.from(agentsByKey.values());
  }, [overview?.agents]);
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
  const requirementCount = useMemo(() => {
    const ids = new Set<string>();
    for (const task of allTasks) {
      ids.add(getRequirementId(task));
    }
    return ids.size;
  }, [allTasks]);

  useEffect(() => {
    if (selectedAgentKey && assignableAgents.some((item) => item.key === selectedAgentKey)) {
      return;
    }
    setSelectedAgentKey(assignableAgents[0]?.key ?? '');
  }, [assignableAgents, selectedAgentKey]);

  const columns = useMemo<BoardColumn[]>(() => {
    if (viewMode === 'status') {
      return STATUS_COLUMNS.map((column) => ({
        id: `status:${column.key}`,
        title: column.title,
        tasks: allTasks.filter((task) => task.status === column.key),
      }));
    }

    if (viewMode === 'requirement') {
      const grouped = new Map<string, BoardColumn>();
      for (const task of allTasks) {
        const requirementId = getRequirementId(task);
        if (!grouped.has(requirementId)) {
          grouped.set(requirementId, {
            id: `requirement:${requirementId}`,
            title: getRequirementTitle(task, requirementId),
            requirementId,
            tasks: [],
          });
        }
        grouped.get(requirementId)?.tasks.push(task);
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
  }, [allAgentNames, allTasks, viewMode]);

  const selectedAgent = useMemo(
    () => assignableAgents.find((item) => item.key === selectedAgentKey) ?? null,
    [assignableAgents, selectedAgentKey]
  );
  const canCreateTask = requirementInput.trim().length > 0 && selectedAgent !== null;

  const canSubmitAgent = newAgentName.trim().length > 0;

  const handleConfirmCreateAgent = useCallback(() => {
    const name = newAgentName.trim();
    if (!name) {
      return;
    }
    setCustomAgentNames((prev) => (prev.includes(name) ? prev : [...prev, name]));
    setNewAgentName('');
    setIsAddAgentModalOpen(false);
  }, [newAgentName]);

  const handleCreateTask = useCallback(async () => {
    const requirement = requirementInput.trim();
    if (!requirement) {
      addToast('请先输入需求', 'warning');
      return;
    }
    if (!selectedAgent) {
      addToast('请先指派 Agent', 'warning');
      return;
    }

    try {
      await createKanbanTask(
        {
          requirement,
          agent_id: selectedAgent.agentId,
          agent_name: selectedAgent.agentName,
          instance_id: selectedAgent.instanceId,
        },
        { instanceId: selectedAgent.instanceId },
        'default'
      );
      setIsCreateModalOpen(false);
      setRequirementInput('');
      addToast('已创建任务并进入队列', 'success');
      await loadOverview();
    } catch (error) {
      const message = error instanceof Error ? error.message : '创建任务失败';
      addToast(message, 'error');
    }
  }, [addToast, loadOverview, requirementInput, selectedAgent]);

  const handleCreateFlow = useCallback(() => {
    const requirement = requirementInput.trim();
    const draftExecutorAgentId = selectedAgent?.agentId ?? '';
    const draftFlowName = requirement ? (requirement.length <= 8 ? requirement : `${requirement.slice(0, 8)}...`) : '';
    setIsCreateModalOpen(false);
    setRequirementInput('');
    navigate('/flow', {
      state: {
        open_create_modal: true,
        draft_requirement: requirement || undefined,
        draft_flow_name: draftFlowName || undefined,
        draft_executor_agent_id: draftExecutorAgentId || undefined,
      },
    });
  }, [navigate, requirementInput, selectedAgent?.agentId]);

  const handleDeleteTaskNode = useCallback(async (task: BoardTask) => {
    const confirmed = window.confirm(`确认删除节点「${task.title}」吗？`);
    if (!confirmed) {
      return;
    }

    try {
      await deleteKanbanTask(task.id);
      if (selectedTask?.id === task.id) {
        setSelectedTask(null);
      }
      addToast('已删除需求节点', 'success');
      await loadOverview();
    } catch (error) {
      const message = error instanceof Error ? error.message : '删除需求节点失败';
      addToast(message, 'error');
    }
  }, [addToast, loadOverview, selectedTask?.id]);

  const handleDeleteRequirement = useCallback(async (targetRequirementId: string, targetTitle: string) => {
    const confirmed = window.confirm(`确认删除需求「${targetTitle}」下的全部节点吗？`);
    if (!confirmed) {
      return;
    }

    try {
      await deleteKanbanRequirementTasks(targetRequirementId);
      if (selectedTask && getRequirementId(selectedTask) === targetRequirementId) {
        setSelectedTask(null);
      }
      addToast('已删除该需求下的全部节点', 'success');
      await loadOverview();
    } catch (error) {
      const message = error instanceof Error ? error.message : '删除需求失败';
      addToast(message, 'error');
    }
  }, [addToast, loadOverview, selectedTask]);

  return (
    <section style={pageStyle} aria-label="kanban-workbench">
      <header style={flatToolbarStyle}>
        <div style={toolbarStatsStyle} aria-label="看板统计">
          <span style={statsItemStyle}>需求数量 {requirementCount}</span>
        </div>
        <div style={toolbarGroupStyle}>
          <button
            type="button"
            style={flatActionButtonStyle}
            onClick={() => setIsCreateModalOpen(true)}
            aria-label="➕任务"
          >
            ➕任务
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
            <option value="requirement">按需求分列</option>
          </select>
        </div>
      </header>

      {isCreateModalOpen ? (
        <div style={modalOverlayStyle} role="dialog" aria-modal="true" aria-label="创建任务入口">
          <div style={modalCardStyle}>
            <h3 style={modalTitleStyle}>创建任务</h3>
            <label htmlFor="quick-create-requirement" style={modalLabelStyle}>
              需求
            </label>
            <textarea
              id="quick-create-requirement"
              value={requirementInput}
              onChange={(event) => setRequirementInput(event.target.value)}
              placeholder="输入需求描述..."
              style={modalTextareaStyle}
            />
            <label htmlFor="quick-create-agent" style={modalLabelStyle}>
              指派 Agent
            </label>
            <select
              id="quick-create-agent"
              value={selectedAgentKey}
              onChange={(event) => setSelectedAgentKey(event.target.value)}
              style={viewSelectStyle}
              disabled={assignableAgents.length === 0}
            >
              {assignableAgents.length === 0 ? (
                <option value="">暂无可用 Agent</option>
              ) : (
                assignableAgents.map((agent) => (
                  <option key={agent.key} value={agent.key}>
                    {agent.agentName} ({agent.instanceName})
                  </option>
                ))
              )}
            </select>
            <div style={modalActionStyle}>
              <button type="button" style={flatActionButtonStyle} onClick={() => void handleCreateTask()} disabled={!canCreateTask}>
                创建任务
              </button>
              <button type="button" style={flatActionButtonStyle} onClick={handleCreateFlow}>
                创建流程
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
          {columns.map((column) => (
            <article key={column.id} style={isMobile ? mobileColumnStyle : columnStyle}>
              <header style={columnHeaderStyle}>
                <h3 style={columnTitleStyle}>{column.title}</h3>
                <div style={columnHeaderActionStyle}>
                  <span style={columnCountStyle}>{column.tasks.length}</span>
                  {viewMode === 'requirement' && column.requirementId ? (
                    <button
                      type="button"
                      style={deleteRequirementButtonStyle}
                      aria-label={`删除需求 ${column.title}`}
                      onClick={() => void handleDeleteRequirement(column.requirementId as string, column.title)}
                    >
                      删除需求
                    </button>
                  ) : null}
                </div>
              </header>
              <div style={isMobile ? mobileColumnBodyStyle : columnBodyStyle}>
                {loading ? (
                  <p style={emptyTextStyle}>同步中...</p>
                ) : column.tasks.length === 0 ? (
                  <p style={emptyTextStyle}>暂无任务</p>
                ) : (
                  column.tasks.map((task) => (
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
                      <div style={taskCardActionRowStyle}>
                        <button
                          type="button"
                          style={taskCardDeleteButtonStyle}
                          aria-label={`删除节点 ${task.title}`}
                          onClick={() => void handleDeleteTaskNode(task)}
                        >
                          删除节点
                        </button>
                      </div>
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

function getRequirementId(task: BoardTask): string {
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

function getRequirementTitle(task: BoardTask, requirementId: string): string {
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
  position: 'sticky',
  top: 0,
  zIndex: 50,
  border: '1px solid rgba(15, 23, 42, 0.1)',
  borderRadius: '0.4rem',
  background: 'rgba(255, 255, 255, 0.44)',
  backdropFilter: 'blur(8px)',
  padding: '0.55rem 0.65rem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.65rem',
  flexWrap: 'wrap',
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

const modalInputTextStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid rgba(15, 23, 42, 0.2)',
  borderRadius: '0.5rem',
  padding: '0.55rem 0.65rem',
  fontSize: '0.85rem',
};

const modalTextareaStyle: React.CSSProperties = {
  width: '100%',
  minHeight: '5.6rem',
  border: '1px solid rgba(15, 23, 42, 0.2)',
  borderRadius: '0.5rem',
  padding: '0.55rem 0.65rem',
  fontSize: '0.85rem',
  resize: 'vertical',
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

const columnHeaderActionStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.42rem',
};

const deleteRequirementButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(185, 28, 28, 0.28)',
  background: 'rgba(254, 242, 242, 0.92)',
  color: '#991b1b',
  borderRadius: '0.32rem',
  padding: '0.16rem 0.44rem',
  fontSize: '0.67rem',
  fontWeight: 700,
  cursor: 'pointer',
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

const taskCardActionRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  padding: '0 0.55rem 0.45rem',
};

const taskCardDeleteButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(185, 28, 28, 0.26)',
  background: 'rgba(254, 242, 242, 0.92)',
  color: '#991b1b',
  borderRadius: '0.3rem',
  padding: '0.2rem 0.46rem',
  fontSize: '0.68rem',
  fontWeight: 700,
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
