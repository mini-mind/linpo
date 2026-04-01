import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  deleteKanbanRequirementTasks,
  generateFlowFromRequirement,
  getAggregateOverview,
  listKanbanTasks,
  renameFlowRequirement,
} from '../api/client';
import type {
  AggregateOverviewAgentItem,
  AggregateOverviewResponse,
  FlowCanvasEdge,
  FlowCanvasNode,
  KanbanTaskItem,
} from '../api/types';
import { useToast } from '../hooks/useToast';
import {
  buildDraftFlowName,
  deleteFlowDraft,
  getFlowDraftById,
  listFlowDrafts,
  upsertFlowDraft,
} from './flowDraftStore';

type FlowListItem = {
  id: string;
  name: string;
  source: 'submitted' | 'draft';
  updatedAt: string;
  nodeCount: number;
  statusSummary: string;
  hasSubmitted: boolean;
  hasDraft: boolean;
};

type AssignableAgent = {
  key: string;
  agentId: string;
  agentName: string;
  instanceId: string;
  instanceName: string;
};

type FlowListRouteState = {
  open_create_modal?: boolean;
  draft_requirement?: string;
  draft_flow_name?: string;
  draft_executor_agent_id?: string;
};

type DraftLaneRecord = {
  id: string;
  name: string;
  agent_id: string | null;
  created_at: string;
};

const FIXED_PLANNER_AGENT_ID = 'claw3';
const FIXED_FLOW_AGENT_ID = 'claw3';

type FlowFilterSource = 'all' | 'submitted' | 'draft';
type FlowSortMode = 'updated_desc' | 'updated_asc' | 'name_asc' | 'name_desc' | 'node_desc';

export function FlowListPage(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const { addToast } = useToast();

  const [overview, setOverview] = useState<AggregateOverviewResponse | null>(null);
  const [tasks, setTasks] = useState<KanbanTaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [flowNameInput, setFlowNameInput] = useState('');
  const [requirementInput, setRequirementInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [filterKeyword, setFilterKeyword] = useState('');
  const [filterSource, setFilterSource] = useState<FlowFilterSource>('all');
  const [sortMode, setSortMode] = useState<FlowSortMode>('updated_desc');

  const [editingFlow, setEditingFlow] = useState<FlowListItem | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const [isRenamingFlow, setIsRenamingFlow] = useState(false);
  const [isDeletingFlow, setIsDeletingFlow] = useState(false);

  const assignableAgents = useMemo<AssignableAgent[]>(() => {
    const map = new Map<string, AssignableAgent>();
    for (const agent of overview?.agents ?? []) {
      const agentId = agent.agent_id.trim();
      const instanceId = agent.instance_id.trim();
      if (!agentId || !instanceId) {
        continue;
      }
      const key = `${instanceId}::${agentId}`;
      if (map.has(key)) {
        continue;
      }
      map.set(key, {
        key,
        agentId,
        agentName: agent.agent_name.trim() || agentId,
        instanceId,
        instanceName: agent.instance_name.trim() || instanceId,
      });
    }
    return Array.from(map.values());
  }, [overview?.agents]);

  const flowAgent = useMemo(
    () => assignableAgents.find((item) => item.agentId === FIXED_FLOW_AGENT_ID) ?? null,
    [assignableAgents]
  );

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [overviewData, items] = await Promise.all([getAggregateOverview(), listKanbanTasks(undefined, 'default')]);
      setOverview(overviewData);
      setTasks(items);
    } catch (err) {
      const message = err instanceof Error ? err.message : '加载流程列表失败';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const state = (location.state as FlowListRouteState | null) ?? null;
    if (!state?.open_create_modal) {
      return;
    }

    setIsCreateModalOpen(true);
    setRequirementInput(String(state.draft_requirement ?? ''));
    setFlowNameInput(String(state.draft_flow_name ?? ''));

    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);

  const flowItems = useMemo<FlowListItem[]>(() => {
    const grouped = new Map<string, KanbanTaskItem[]>();
    for (const task of tasks) {
      const requirementId = String(task.extras.requirement_id ?? '').trim() || task.id;
      const list = grouped.get(requirementId) ?? [];
      list.push(task);
      grouped.set(requirementId, list);
    }

    const submitted = Array.from(grouped.entries()).map(([requirementId, group]) => {
      const sorted = [...group].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
      const latest = sorted[0];
      const name = String(latest?.extras.requirement_title ?? '').trim() || latest?.title || `流程 ${requirementId.slice(0, 8)}`;
      const runningCount = group.filter((task) => task.status === 'running').length;
      const blockedCount = group.filter((task) => task.status === 'blocked_by_approval').length;
      const queuedCount = group.filter((task) => task.status === 'queued').length;
      const summary =
        runningCount > 0
          ? `进行中 ${runningCount}`
          : blockedCount > 0
            ? `待审批 ${blockedCount}`
            : queuedCount > 0
              ? `待调度 ${queuedCount}`
              : '已提交';
      return {
        id: requirementId,
        name,
        source: 'submitted' as const,
        updatedAt: latest?.updated_at ?? new Date().toISOString(),
        nodeCount: group.length,
        statusSummary: summary,
        hasSubmitted: true,
        hasDraft: false,
      };
    });

    const submittedById = new Map<string, FlowListItem>();
    for (const item of submitted) {
      submittedById.set(item.id, item);
    }

    const drafts = listFlowDrafts().map((draft) => {
      const submittedMatch = submittedById.get(draft.id);
      return {
        id: draft.id,
        name: draft.name,
        source: 'draft' as const,
        updatedAt: draft.updated_at,
        nodeCount: draft.nodes.length,
        statusSummary: '草稿',
        hasSubmitted: Boolean(submittedMatch),
        hasDraft: true,
      } satisfies FlowListItem;
    });

    const mergedById = new Map<string, FlowListItem>();
    for (const item of submitted) {
      mergedById.set(item.id, item);
    }
    for (const item of drafts) {
      mergedById.set(item.id, item);
    }

    return Array.from(mergedById.values());
  }, [tasks]);

  const filteredFlowItems = useMemo<FlowListItem[]>(() => {
    const keyword = filterKeyword.trim().toLowerCase();
    const filtered = flowItems.filter((item) => {
      if (filterSource === 'draft' && !item.hasDraft) {
        return false;
      }
      if (filterSource === 'submitted' && !item.hasSubmitted) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      return item.name.toLowerCase().includes(keyword) || item.id.toLowerCase().includes(keyword);
    });
    filtered.sort((left, right) => {
      if (sortMode === 'updated_asc') {
        return Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
      }
      if (sortMode === 'name_asc') {
        return left.name.localeCompare(right.name, 'zh-CN');
      }
      if (sortMode === 'name_desc') {
        return right.name.localeCompare(left.name, 'zh-CN');
      }
      if (sortMode === 'node_desc') {
        return right.nodeCount - left.nodeCount || Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
      }
      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    });
    return filtered;
  }, [filterKeyword, filterSource, flowItems, sortMode]);

  const handleOpenCreateModal = useCallback(() => {
    setIsCreateModalOpen(true);
    setFlowNameInput('');
    setRequirementInput('');
  }, []);

  const handleOpenEditModal = useCallback((flow: FlowListItem) => {
    setEditingFlow(flow);
    setRenameInput(flow.name);
  }, []);

  const handleRenameFlowFromList = useCallback(async () => {
    if (!editingFlow) {
      return;
    }
    const nextName = renameInput.trim();
    if (!nextName) {
      addToast('流程名称不能为空', 'warning');
      return;
    }
    setIsRenamingFlow(true);
    try {
      if (editingFlow.hasSubmitted) {
        await renameFlowRequirement(editingFlow.id, { name: nextName }, undefined, 'default');
      }
      if (editingFlow.hasDraft) {
        const draft = getFlowDraftById(editingFlow.id);
        if (draft) {
          upsertFlowDraft({
            ...draft,
            name: nextName,
            updated_at: new Date().toISOString(),
          });
        }
      }
      setEditingFlow((current) => (current ? { ...current, name: nextName } : current));
      addToast('流程名称已更新', 'success');
      await loadData();
    } catch (error) {
      const message = error instanceof Error ? error.message : '流程重命名失败';
      addToast(message, 'error');
    } finally {
      setIsRenamingFlow(false);
    }
  }, [addToast, editingFlow, loadData, renameInput]);

  const handleDeleteFlowFromList = useCallback(async () => {
    if (!editingFlow) {
      return;
    }
    const confirmed = window.confirm(`确认删除流程「${editingFlow.name}」吗？`);
    if (!confirmed) {
      return;
    }
    setIsDeletingFlow(true);
    try {
      if (editingFlow.hasSubmitted) {
        await deleteKanbanRequirementTasks(editingFlow.id, undefined, 'default');
      }
      if (editingFlow.hasDraft) {
        deleteFlowDraft(editingFlow.id);
      }
      addToast('流程已删除', 'success');
      setEditingFlow(null);
      await loadData();
    } catch (error) {
      const message = error instanceof Error ? error.message : '流程删除失败';
      addToast(message, 'error');
    } finally {
      setIsDeletingFlow(false);
    }
  }, [addToast, editingFlow, loadData]);

  const handleCreateFlow = useCallback(async () => {
    const requirement = requirementInput.trim();
    const rawName = flowNameInput.trim();
    const selected = flowAgent;
    const createdAt = new Date().toISOString();
    const draftId = `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const resolvedName = rawName || buildDraftFlowName(requirement);

    if (!requirement) {
      const fallbackLane = buildInitialLanes(selected, createdAt);
      upsertFlowDraft({
        id: draftId,
        name: resolvedName,
        requirement: '',
        nodes: [],
        edges: [],
        lanes: fallbackLane,
        node_lane_by_id: {},
        planner_session_key: null,
        execution_session_prefix: null,
        executor_agent_id: selected?.agentId ?? null,
        created_at: createdAt,
        updated_at: createdAt,
      });
      setIsCreateModalOpen(false);
      navigate(`/flow/edit/${encodeURIComponent(draftId)}`);
      return;
    }

    if (!selected) {
      addToast(`当前缺少固定流程 Agent（${FIXED_FLOW_AGENT_ID}），无法生成流程`, 'warning');
      return;
    }

    setIsGenerating(true);
    try {
      const generated = await generateFlowFromRequirement(
        {
          requirement,
          instance_id: selected.instanceId,
          executor_agent_id: selected.agentId,
          planner_agent_id: FIXED_PLANNER_AGENT_ID,
          manager_agent_id: selected.agentId,
        },
        { instanceId: selected.instanceId },
        'default'
      );

      const distributedNodes = distributeNodesByTopology(
        generated.nodes,
        generated.edges,
        [selected.agentId],
        selected.agentId
      );
      const lanePayload = buildLanePayload(distributedNodes, overview?.agents ?? [], createdAt, selected);

      upsertFlowDraft({
        id: draftId,
        name: resolvedName,
        requirement,
        nodes: distributedNodes,
        edges: generated.edges,
        lanes: lanePayload.lanes,
        node_lane_by_id: lanePayload.nodeLaneById,
        planner_session_key: generated.planner_session_key,
        execution_session_prefix: generated.execution_session_prefix,
        executor_agent_id: selected.agentId,
        created_at: createdAt,
        updated_at: createdAt,
      });
      setIsCreateModalOpen(false);
      navigate(`/flow/edit/${encodeURIComponent(draftId)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : '流程生成失败';
      addToast(message, 'error');
    } finally {
      setIsGenerating(false);
    }
  }, [addToast, flowAgent, flowNameInput, navigate, overview?.agents, requirementInput]);

  return (
    <section style={pageStyle} aria-label="all-flows-page">
      <header style={toolbarStyle} role="toolbar" aria-label="流程列表工具栏">
        <div style={toolbarFilterGroupStyle}>
          <input
            value={filterKeyword}
            onChange={(event) => setFilterKeyword(event.target.value)}
            placeholder="筛选流程（名称/ID）"
            style={toolbarInputStyle}
            aria-label="流程筛选"
          />
          <select
            value={filterSource}
            onChange={(event) => setFilterSource(event.target.value as FlowFilterSource)}
            style={toolbarSelectStyle}
            aria-label="来源筛选"
          >
            <option value="all">全部来源</option>
            <option value="submitted">已提交</option>
            <option value="draft">草稿</option>
          </select>
          <select
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value as FlowSortMode)}
            style={toolbarSelectStyle}
            aria-label="流程排序"
          >
            <option value="updated_desc">按更新时间（新到旧）</option>
            <option value="updated_asc">按更新时间（旧到新）</option>
            <option value="name_asc">按名称（A-Z）</option>
            <option value="name_desc">按名称（Z-A）</option>
            <option value="node_desc">按节点数（多到少）</option>
          </select>
        </div>
        <button type="button" style={primaryButtonStyle} onClick={handleOpenCreateModal}>
          新建流程
        </button>
      </header>

      <div style={contentShellStyle}>
        <div style={contentInnerStyle}>
          {loading ? <p style={hintStyle}>流程列表加载中...</p> : null}
          {error ? <p style={errorStyle}>{error}</p> : null}

          {!loading && !error && filteredFlowItems.length === 0 ? (
            <p style={hintStyle}>暂无流程，点击“新建流程”开始创建。</p>
          ) : null}

          {!loading && !error && filteredFlowItems.length > 0 ? (
            <div style={listPanelStyle}>
              <div style={listStyle}>
                {filteredFlowItems.map((flow) => (
                  <article key={`${flow.source}:${flow.id}`} style={cardStyle}>
                    <button
                      type="button"
                      style={cardOpenButtonStyle}
                      onClick={() => navigate(`/flow/edit/${encodeURIComponent(flow.id)}`)}
                      aria-label={`打开流程-${flow.name}`}
                    >
                      <div style={cardMainStyle}>
                        <h2 style={cardTitleStyle}>{flow.name}</h2>
                        <p style={cardMetaStyle}>
                          {flow.source === 'draft' ? '草稿流程' : '已提交流程'} · 节点 {flow.nodeCount} · {flow.statusSummary}
                        </p>
                        <p style={cardMetaStyle}>更新时间 {new Date(flow.updatedAt).toLocaleString('zh-CN')}</p>
                      </div>
                    </button>
                    <div style={cardActionGroupStyle}>
                      <button
                        type="button"
                        style={secondaryButtonStyle}
                        onClick={() => handleOpenEditModal(flow)}
                        aria-label={`编辑流程-${flow.name}`}
                      >
                        编辑
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {editingFlow ? (
        <div style={modalOverlayStyle} role="dialog" aria-modal="true" aria-label="编辑流程">
          <div style={modalCardStyle}>
            <h2 style={modalTitleStyle}>编辑流程</h2>
            <p style={modalDescStyle}>{editingFlow.name}</p>

            <label style={modalLabelStyle} htmlFor="flow-rename-input">
              重命名流程
            </label>
            <input
              id="flow-rename-input"
              value={renameInput}
              onChange={(event) => setRenameInput(event.target.value)}
              placeholder="输入新的流程名称"
              style={modalInputStyle}
              disabled={isRenamingFlow || isDeletingFlow}
            />

            <div style={editActionGridStyle}>
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={() => void handleRenameFlowFromList()}
                disabled={isRenamingFlow || isDeletingFlow}
              >
                {isRenamingFlow ? '保存中...' : '保存名称'}
              </button>
              <button
                type="button"
                style={dangerButtonStyle}
                onClick={() => void handleDeleteFlowFromList()}
                disabled={isRenamingFlow || isDeletingFlow}
              >
                {isDeletingFlow ? '删除中...' : '删除流程'}
              </button>
            </div>

            <div style={modalActionRowStyle}>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() => setEditingFlow(null)}
                disabled={isRenamingFlow || isDeletingFlow}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isCreateModalOpen ? (
        <div style={modalOverlayStyle} role="dialog" aria-modal="true" aria-label="新建流程">
          <div style={modalCardStyle}>
            <h2 style={modalTitleStyle}>新建流程</h2>
            <p style={modalDescStyle}>流程名和需求都可以留空；有需求会先自动拆解，再跳转到编辑画布。</p>

            <label style={modalLabelStyle} htmlFor="flow-name-input">
              流程名（可选）
            </label>
            <input
              id="flow-name-input"
              value={flowNameInput}
              onChange={(event) => setFlowNameInput(event.target.value)}
              placeholder="默认自动命名（未命名流程 / 需求前 8 字）"
              style={modalInputStyle}
              disabled={isGenerating}
            />

            <label style={modalLabelStyle} htmlFor="flow-requirement-input">
              需求（可选）
            </label>
            <textarea
              id="flow-requirement-input"
              value={requirementInput}
              onChange={(event) => setRequirementInput(event.target.value)}
              placeholder="可留空，留空则创建空流程"
              style={modalTextareaStyle}
              disabled={isGenerating}
            />

            <p style={modalDescStyle}>固定拆解 Agent：{FIXED_FLOW_AGENT_ID}</p>

            {isGenerating ? <p style={generatingHintStyle}>流程拆解中，请稍候...</p> : null}

            <div style={modalActionRowStyle}>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() => setIsCreateModalOpen(false)}
                disabled={isGenerating}
              >
                取消
              </button>
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={() => void handleCreateFlow()}
                disabled={isGenerating}
              >
                {isGenerating ? '生成中...' : '创建并进入编辑'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function buildInitialLanes(selected: AssignableAgent | null, createdAt: string): DraftLaneRecord[] {
  if (!selected) {
    return [
      {
        id: 'lane_unassigned',
        name: '未委派泳道',
        agent_id: null,
        created_at: createdAt,
      },
    ];
  }
  return [
    {
      id: `lane_${selected.agentId}`,
      name: selected.agentName,
      agent_id: selected.agentId,
      created_at: createdAt,
    },
  ];
}

function buildLanePayload(
  nodes: FlowCanvasNode[],
  agents: AggregateOverviewAgentItem[],
  createdAt: string,
  fallback: AssignableAgent | null
): { lanes: DraftLaneRecord[]; nodeLaneById: Record<string, string> } {
  const nameById = new Map<string, string>();
  for (const agent of agents) {
    const agentId = agent.agent_id.trim();
    if (!agentId) continue;
    nameById.set(agentId, agent.agent_name.trim() || agentId);
  }
  const lanes: DraftLaneRecord[] = [];
  const laneIdByAgent = new Map<string, string>();
  const nodeLaneById: Record<string, string> = {};

  for (const node of nodes) {
    const agentId = String(node.agent_id ?? '').trim() || fallback?.agentId || '';
    const laneKey = agentId || 'unassigned';
    let laneId = laneIdByAgent.get(laneKey);
    if (!laneId) {
      laneId = laneKey === 'unassigned' ? 'lane_unassigned' : `lane_${laneKey}`;
      laneIdByAgent.set(laneKey, laneId);
      lanes.push({
        id: laneId,
        name: agentId ? nameById.get(agentId) ?? agentId : '未委派泳道',
        agent_id: agentId || null,
        created_at: createdAt,
      });
    }
    nodeLaneById[node.id] = laneId;
  }

  if (lanes.length === 0) {
    return {
      lanes: buildInitialLanes(fallback, createdAt),
      nodeLaneById,
    };
  }

  return { lanes, nodeLaneById };
}

function distributeNodesByTopology(
  nodes: FlowCanvasNode[],
  edges: FlowCanvasEdge[],
  availableAgentIds: string[],
  fallbackAgentId: string
): FlowCanvasNode[] {
  if (nodes.length === 0) {
    return [];
  }

  const agentPool = Array.from(
    new Set([fallbackAgentId.trim(), ...availableAgentIds.map((item) => item.trim())].filter((item) => item !== ''))
  );
  if (agentPool.length === 0) {
    return nodes;
  }

  const indegree = new Map<string, number>();
  const graph = new Map<string, string[]>();
  const layer = new Map<string, number>();
  for (const node of nodes) {
    indegree.set(node.id, 0);
    graph.set(node.id, []);
    layer.set(node.id, 0);
  }
  for (const edge of edges) {
    if (!indegree.has(edge.source) || !indegree.has(edge.target) || edge.source === edge.target) {
      continue;
    }
    graph.get(edge.source)?.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }
  const queue = Array.from(indegree.entries())
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id);
  const visited: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    visited.push(current);
    const currentLayer = layer.get(current) ?? 0;
    for (const next of graph.get(current) ?? []) {
      layer.set(next, Math.max(layer.get(next) ?? 0, currentLayer + 1));
      indegree.set(next, (indegree.get(next) ?? 0) - 1);
      if ((indegree.get(next) ?? 0) === 0) {
        queue.push(next);
      }
    }
  }

  const fallbackLayerByNode = new Map<string, number>();
  if (visited.length !== nodes.length) {
    let index = 0;
    for (const node of nodes) {
      fallbackLayerByNode.set(node.id, index);
      index += 1;
    }
  }

  const distributed = nodes.map((node) => ({ ...node }));
  const indexByLayer = new Map<number, number>();
  for (const node of distributed) {
    const lv = layer.get(node.id) ?? fallbackLayerByNode.get(node.id) ?? 0;
    const offset = indexByLayer.get(lv) ?? 0;
    indexByLayer.set(lv, offset + 1);
    node.agent_id = agentPool[(lv + offset) % agentPool.length];
  }
  return distributed;
}

const pageStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.9rem',
  width: '100%',
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
};

const contentShellStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  width: '100%',
  padding: '0 0.85rem 0.85rem',
  display: 'flex',
  justifyContent: 'center',
  boxSizing: 'border-box',
};

const contentInnerStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: '1600px',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.7rem',
};

const toolbarStyle: React.CSSProperties = {
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

const toolbarFilterGroupStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  flexWrap: 'wrap',
};

const toolbarInputStyle: React.CSSProperties = {
  width: '220px',
  maxWidth: '100%',
  border: '1px solid rgba(15, 23, 42, 0.16)',
  borderRadius: '0.35rem',
  padding: '0.35rem 0.45rem',
  fontSize: '0.8rem',
  background: 'rgba(255, 255, 255, 0.72)',
};

const toolbarSelectStyle: React.CSSProperties = {
  border: '1px solid rgba(15, 23, 42, 0.16)',
  borderRadius: '0.35rem',
  padding: '0.35rem 0.45rem',
  fontSize: '0.8rem',
  background: 'rgba(255, 255, 255, 0.72)',
};

const listPanelStyle: React.CSSProperties = {
  border: '1px solid rgba(15, 23, 42, 0.1)',
  borderRadius: '0.4rem',
  background: 'rgba(255, 255, 255, 0.32)',
  backdropFilter: 'blur(8px)',
  padding: '0.65rem',
  minWidth: 0,
};

const listStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
  gap: '0.6rem',
};

const cardStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.3)',
  borderRadius: '0.5rem',
  background: 'rgba(255, 255, 255, 0.86)',
  backdropFilter: 'blur(4px)',
  padding: '0.62rem',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '0.65rem',
};

const cardOpenButtonStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  padding: 0,
  margin: 0,
  minWidth: 0,
  flex: 1,
  textAlign: 'left',
  cursor: 'pointer',
};

const cardMainStyle: React.CSSProperties = {
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.24rem',
};

const cardActionGroupStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
};

const cardTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.9rem',
  color: '#0f172a',
  wordBreak: 'break-all',
};

const cardMetaStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.74rem',
  color: '#475569',
};

const primaryButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(15, 23, 42, 0.16)',
  background: 'rgba(255, 255, 255, 0.72)',
  color: '#1f2937',
  borderRadius: '0.35rem',
  padding: '0.4rem 0.68rem',
  fontSize: '0.8rem',
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.5)',
  background: 'rgba(255, 255, 255, 0.72)',
  color: '#0f172a',
  borderRadius: '0.35rem',
  padding: '0.4rem 0.68rem',
  fontSize: '0.8rem',
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const dangerButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(220, 38, 38, 0.45)',
  background: 'rgba(254, 242, 242, 0.86)',
  color: '#b91c1c',
  borderRadius: '0.35rem',
  padding: '0.4rem 0.68rem',
  fontSize: '0.8rem',
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const hintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.82rem',
  color: '#64748b',
};

const errorStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.82rem',
  color: '#b91c1c',
};

const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 120,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '1rem',
  background: 'rgba(15, 23, 42, 0.45)',
};

const modalCardStyle: React.CSSProperties = {
  width: 'min(560px, calc(100vw - 2rem))',
  borderRadius: '0.8rem',
  border: '1px solid rgba(148, 163, 184, 0.32)',
  background: 'rgba(255, 255, 255, 0.97)',
  boxShadow: '0 28px 56px -34px rgba(15, 23, 42, 0.86)',
  padding: '0.9rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.58rem',
};

const modalTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '1rem',
  color: '#0f172a',
  fontWeight: 700,
};

const modalDescStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.78rem',
  color: '#475569',
};

const modalLabelStyle: React.CSSProperties = {
  fontSize: '0.78rem',
  fontWeight: 600,
  color: '#334155',
};

const modalInputStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid rgba(15, 23, 42, 0.16)',
  borderRadius: '0.45rem',
  padding: '0.45rem 0.52rem',
  fontSize: '0.82rem',
  color: '#0f172a',
  background: 'rgba(255, 255, 255, 0.98)',
};

const modalTextareaStyle: React.CSSProperties = {
  ...modalInputStyle,
  minHeight: '96px',
  resize: 'vertical',
};

const generatingHintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.76rem',
  color: '#0369a1',
  fontWeight: 600,
};

const modalActionRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '0.48rem',
};

const editActionGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '0.48rem',
};
