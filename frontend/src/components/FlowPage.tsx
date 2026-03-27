import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAggregateOverview, sendChatMessage } from '../api/client';
import type { AggregateOverviewResponse } from '../api/types';
import type { BoardTask, TaskStatus } from './kanbanTypes';
import { appendFlowTasks } from '../state/flowTaskStore';
import { useToast } from '../hooks/useToast';

interface FlowNodeDraft {
  id: string;
  title: string;
  depends_on: string[];
  sensitive?: boolean;
  agent_id?: string;
  notes?: string;
}

export function FlowPage(): JSX.Element {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [overview, setOverview] = useState<AggregateOverviewResponse | null>(null);

  const [requirement, setRequirement] = useState('');
  const [flowText, setFlowText] = useState('[]');
  const [layerPreview, setLayerPreview] = useState<string[]>([]);
  const [generatedByOpenClaw, setGeneratedByOpenClaw] = useState(false);

  const agentMap = useMemo(
    () => new Map((overview?.agents ?? []).map((item) => [item.agent_id, item.agent_name])),
    [overview?.agents]
  );

  useEffect(() => {
    void getAggregateOverview().then(setOverview).catch(() => {
      setOverview(null);
    });
  }, []);

  const handleGenerateFlow = useCallback(async () => {
    const sentence = requirement.trim();
    if (!sentence) {
      addToast('请先输入一句话需求', 'warning');
      return;
    }

    const fallbackAgent = overview?.agents[0] ?? null;

    if (fallbackAgent) {
      try {
        await sendChatMessage({
          agentId: fallbackAgent.agent_id,
          sessionKey: '__new__',
          message: `请将以下需求拆分为可并行执行的流程节点，并标注依赖。需求：${sentence}`,
        });
        setGeneratedByOpenClaw(true);
      } catch (error) {
        setGeneratedByOpenClaw(false);
        const message = error instanceof Error ? error.message : 'OpenClaw 调用失败';
        addToast(`OpenClaw 生成请求失败：${message}`, 'warning');
      }
    } else {
      setGeneratedByOpenClaw(false);
      addToast('当前没有可用 agent，已使用本地规则生成草图', 'info');
    }

    const draft = buildDefaultFlowDraft(sentence, fallbackAgent?.agent_id ?? null);
    setFlowText(JSON.stringify(draft, null, 2));
    addToast('流程草图已生成，可继续手动编辑', 'success');
  }, [addToast, overview?.agents, requirement]);

  const handleParseAndAppend = useCallback(() => {
    try {
      const nodes = parseFlowDraft(flowText);
      const layers = resolveDagLayers(nodes);

      const tasks = toBoardTasks(nodes, layers, agentMap);
      appendFlowTasks(tasks);
      setLayerPreview(layers.map((layer, index) => `L${index + 1}: ${layer.join(', ')}`));
      addToast(`流程已入看板：新增 ${tasks.length} 个任务`, 'success');
      navigate('/kanban');
    } catch (error) {
      const message = error instanceof Error ? error.message : '流程解析失败';
      addToast(message, 'error');
    }
  }, [addToast, agentMap, flowText, navigate]);

  return (
    <section style={pageStyle} aria-label="flow-page">
      <header style={headerStyle}>
        <h2 style={titleStyle}>创建流程</h2>
        <div style={headerActionsStyle}>
          <button type="button" style={flatButtonStyle} onClick={() => navigate('/kanban')}>
            返回看板
          </button>
        </div>
      </header>

      <div style={panelStyle}>
        <label htmlFor="flow-requirement" style={fieldLabelStyle}>一句话需求</label>
        <textarea
          id="flow-requirement"
          value={requirement}
          onChange={(event) => setRequirement(event.target.value)}
          placeholder="例如：上线一个新品活动，从素材生成到渠道投放并审批敏感动作。"
          style={requirementInputStyle}
        />
        <div style={statusTextStyle}>
          OpenClaw 调用状态：{generatedByOpenClaw ? '已触发（claw1 或当前实例）' : '未确认调用成功'}
        </div>
        <div style={actionRowStyle}>
          <button type="button" style={primaryButtonStyle} onClick={handleGenerateFlow}>
            生成流程图草稿
          </button>
          <button type="button" style={flatButtonStyle} onClick={handleParseAndAppend}>
            解析并加入看板
          </button>
        </div>
      </div>

      <div style={panelStyle}>
        <label htmlFor="flow-json" style={fieldLabelStyle}>流程定义（JSON）</label>
        <textarea
          id="flow-json"
          value={flowText}
          onChange={(event) => setFlowText(event.target.value)}
          style={flowEditorStyle}
          spellCheck={false}
        />
        <p style={hintStyle}>支持编辑 `depends_on` 依赖；标记 `"sensitive": true` 会生成待审批任务。</p>
      </div>

      <div style={panelStyle}>
        <h3 style={previewTitleStyle}>并行层预览</h3>
        {layerPreview.length === 0 ? (
          <p style={hintStyle}>解析后会显示 DAG 并行层。</p>
        ) : (
          <ul style={layerListStyle}>
            {layerPreview.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function toBoardTasks(
  nodes: FlowNodeDraft[],
  layers: string[][],
  agentMap: Map<string, string>
): BoardTask[] {
  const now = Date.now();
  const tasks: BoardTask[] = [];

  layers.forEach((layer, layerIndex) => {
    for (const nodeId of layer) {
      const node = nodes.find((item) => item.id === nodeId);
      if (!node) continue;

      const status: TaskStatus = node.sensitive ? 'blocked_by_approval' : 'queued';
      const agentName = node.agent_id ? agentMap.get(node.agent_id) ?? `Agent ${node.agent_id}` : '待分配';

      tasks.push({
        id: `flow-${now}-${node.id}`,
        title: node.title,
        summary: node.notes?.trim() || `由流程节点 ${node.id} 派生`,
        status,
        source: 'flow',
        agentId: node.agent_id ?? null,
        agentName,
        artifacts: [
          `流程层级：L${layerIndex + 1}`,
          `依赖节点：${node.depends_on.length > 0 ? node.depends_on.join(', ') : '无'}`,
        ],
        extras: {
          flow_node: node.id,
          layer: `L${layerIndex + 1}`,
          dependencies: node.depends_on.join(', ') || 'none',
        },
      });
    }
  });

  return tasks;
}

function buildDefaultFlowDraft(sentence: string, fallbackAgentId: string | null): FlowNodeDraft[] {
  const fragments = sentence
    .split(/[，,。；;]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  const steps = fragments.length > 0 ? fragments : [sentence.trim()];
  const normalized = steps.slice(0, 6);

  const drafts: FlowNodeDraft[] = normalized.map((title, index) => {
    const id = `node_${index + 1}`;
    const dependsOn: string[] = [];

    if (index === 1 || index === 2) {
      dependsOn.push('node_1');
    } else if (index > 2) {
      dependsOn.push(`node_${index}`);
    }

    return {
      id,
      title,
      depends_on: dependsOn,
      sensitive: index === normalized.length - 1,
      agent_id: fallbackAgentId ?? undefined,
      notes: index === 0 ? '流程入口节点' : undefined,
    };
  });

  if (drafts.length === 1) {
    drafts.push(
      {
        id: 'node_2',
        title: '执行主任务',
        depends_on: ['node_1'],
        agent_id: fallbackAgentId ?? undefined,
      },
      {
        id: 'node_3',
        title: '提交审批与收尾',
        depends_on: ['node_2'],
        sensitive: true,
        agent_id: fallbackAgentId ?? undefined,
      }
    );
  }

  return drafts;
}

function parseFlowDraft(rawText: string): FlowNodeDraft[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('流程 JSON 格式错误，请检查后重试');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('流程草稿必须是数组格式');
  }

  const seen = new Set<string>();
  const nodes: FlowNodeDraft[] = parsed.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`第 ${index + 1} 个节点不是对象`);
    }

    const id = typeof (item as { id?: unknown }).id === 'string' ? (item as { id: string }).id.trim() : '';
    const title =
      typeof (item as { title?: unknown }).title === 'string' ? (item as { title: string }).title.trim() : '';

    if (!id || !title) {
      throw new Error(`第 ${index + 1} 个节点缺少 id 或 title`);
    }

    if (seen.has(id)) {
      throw new Error(`节点 id 重复：${id}`);
    }
    seen.add(id);

    const dependsRaw = (item as { depends_on?: unknown }).depends_on;
    const dependsOn = Array.isArray(dependsRaw)
      ? dependsRaw.filter((dep): dep is string => typeof dep === 'string' && dep.trim().length > 0)
      : [];

    const sensitive = Boolean((item as { sensitive?: unknown }).sensitive);
    const agentId =
      typeof (item as { agent_id?: unknown }).agent_id === 'string'
        ? (item as { agent_id: string }).agent_id.trim() || undefined
        : undefined;
    const notes =
      typeof (item as { notes?: unknown }).notes === 'string'
        ? (item as { notes: string }).notes.trim() || undefined
        : undefined;

    return {
      id,
      title,
      depends_on: dependsOn,
      sensitive,
      agent_id: agentId,
      notes,
    };
  });

  const idSet = new Set(nodes.map((node) => node.id));
  for (const node of nodes) {
    for (const dependency of node.depends_on) {
      if (!idSet.has(dependency)) {
        throw new Error(`节点 ${node.id} 依赖不存在：${dependency}`);
      }
    }
  }

  return nodes;
}

function resolveDagLayers(nodes: FlowNodeDraft[]): string[][] {
  const indegree = new Map<string, number>();
  const graph = new Map<string, string[]>();
  const levels = new Map<string, number>();

  for (const node of nodes) {
    indegree.set(node.id, node.depends_on.length);
    graph.set(node.id, []);
    levels.set(node.id, 0);
  }

  for (const node of nodes) {
    for (const dependency of node.depends_on) {
      graph.get(dependency)?.push(node.id);
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of indegree.entries()) {
    if (degree === 0) {
      queue.push(id);
    }
  }

  const ordered: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    ordered.push(current);

    const currentLevel = levels.get(current) ?? 0;
    const neighbors = graph.get(current) ?? [];

    for (const next of neighbors) {
      const nextLevel = Math.max(levels.get(next) ?? 0, currentLevel + 1);
      levels.set(next, nextLevel);
      indegree.set(next, (indegree.get(next) ?? 0) - 1);
      if ((indegree.get(next) ?? 0) === 0) {
        queue.push(next);
      }
    }
  }

  if (ordered.length !== nodes.length) {
    throw new Error('流程存在循环依赖，无法解析为并行任务');
  }

  const layers: string[][] = [];
  for (const nodeId of ordered) {
    const level = levels.get(nodeId) ?? 0;
    if (!layers[level]) {
      layers[level] = [];
    }
    layers[level].push(nodeId);
  }

  return layers;
}

const pageStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.8rem',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '0.8rem',
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '1.02rem',
  fontWeight: 700,
};

const headerActionsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
};

const panelStyle: React.CSSProperties = {
  border: '1px solid rgba(15, 23, 42, 0.12)',
  background: 'rgba(255, 255, 255, 0.85)',
  borderRadius: '0.65rem',
  padding: '0.75rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.55rem',
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: '0.82rem',
  fontWeight: 600,
};

const requirementInputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: '100px',
  border: '1px solid rgba(100, 116, 139, 0.35)',
  borderRadius: '0.45rem',
  padding: '0.65rem',
  fontSize: '0.88rem',
  resize: 'vertical',
};

const statusTextStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: '#475569',
};

const actionRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0.55rem',
  flexWrap: 'wrap',
};

const primaryButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(13, 148, 136, 0.52)',
  background: '#0d9488',
  color: '#f8fafc',
  borderRadius: '0.45rem',
  padding: '0.42rem 0.7rem',
  fontSize: '0.8rem',
  fontWeight: 600,
  cursor: 'pointer',
};

const flatButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(15, 23, 42, 0.2)',
  background: 'rgba(255, 255, 255, 0.88)',
  color: '#1f2937',
  borderRadius: '0.45rem',
  padding: '0.42rem 0.7rem',
  fontSize: '0.8rem',
  fontWeight: 600,
  cursor: 'pointer',
};

const flowEditorStyle: React.CSSProperties = {
  width: '100%',
  minHeight: '280px',
  border: '1px solid rgba(100, 116, 139, 0.35)',
  borderRadius: '0.45rem',
  padding: '0.65rem',
  fontSize: '0.78rem',
  fontFamily: '"IBM Plex Mono", monospace',
  lineHeight: 1.4,
  resize: 'vertical',
};

const hintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.74rem',
  color: '#475569',
};

const previewTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.86rem',
  fontWeight: 700,
};

const layerListStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: '1rem',
  fontSize: '0.76rem',
  color: '#334155',
  display: 'grid',
  gap: '0.2rem',
};
