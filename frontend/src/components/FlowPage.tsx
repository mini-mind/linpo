import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { generateFlowFromRequirement, getAggregateOverview } from '../api/client';
import type {
  AggregateOverviewAgentItem,
  AggregateOverviewResponse,
  FlowCanvasEdge,
  FlowCanvasNode,
  FlowChatMessageItem,
  FlowGenerateResponse,
} from '../api/types';
import { useToast } from '../hooks/useToast';

type SelectedAgentBundle = {
  plannerAgentId: string;
  managerAgentId: string;
  executorAgentId: string;
};

const NODE_WIDTH = 224;
const NODE_HEIGHT = 96;

export function FlowPage(): JSX.Element {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [overview, setOverview] = useState<AggregateOverviewResponse | null>(null);
  const [requirement, setRequirement] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [flowNodes, setFlowNodes] = useState<FlowCanvasNode[]>([]);
  const [flowEdges, setFlowEdges] = useState<FlowCanvasEdge[]>([]);
  const [messages, setMessages] = useState<FlowChatMessageItem[]>([]);
  const [lastResponse, setLastResponse] = useState<FlowGenerateResponse | null>(null);
  const [selectedAgents, setSelectedAgents] = useState<SelectedAgentBundle>({
    plannerAgentId: '',
    managerAgentId: '',
    executorAgentId: '',
  });

  const uniqueAgents = useMemo(() => {
    const map = new Map<string, AggregateOverviewAgentItem>();
    for (const agent of overview?.agents ?? []) {
      if (!map.has(agent.agent_id)) {
        map.set(agent.agent_id, agent);
      }
    }
    return Array.from(map.values());
  }, [overview?.agents]);

  const agentMap = useMemo(() => {
    return new Map(uniqueAgents.map((agent) => [agent.agent_id, agent]));
  }, [uniqueAgents]);

  useEffect(() => {
    let active = true;
    void getAggregateOverview()
      .then((data) => {
        if (!active) return;
        setOverview(data);
        const fallback = data.agents[0]?.agent_id ?? '';
        setSelectedAgents((current) => ({
          plannerAgentId: current.plannerAgentId || fallback,
          managerAgentId: current.managerAgentId || fallback,
          executorAgentId: current.executorAgentId || fallback,
        }));
      })
      .catch(() => {
        if (!active) return;
        setOverview(null);
      });

    return () => {
      active = false;
    };
  }, []);

  const canvasSize = useMemo(() => {
    if (flowNodes.length === 0) {
      return { width: 1400, height: 760 };
    }

    let maxX = 0;
    let maxY = 0;
    for (const node of flowNodes) {
      maxX = Math.max(maxX, node.x + NODE_WIDTH);
      maxY = Math.max(maxY, node.y + NODE_HEIGHT);
    }
    return {
      width: Math.max(1400, Math.ceil(maxX + 180)),
      height: Math.max(760, Math.ceil(maxY + 180)),
    };
  }, [flowNodes]);

  const nodePositionMap = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const node of flowNodes) {
      map.set(node.id, { x: node.x, y: node.y });
    }
    return map;
  }, [flowNodes]);

  const canSubmit = requirement.trim().length > 0 && selectedAgents.executorAgentId.trim().length > 0;

  const pushMessage = useCallback((message: FlowChatMessageItem) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const handleGenerate = useCallback(async () => {
    const requirementText = requirement.trim();
    if (!requirementText) {
      addToast('请先输入需求', 'warning');
      return;
    }

    const executor = agentMap.get(selectedAgents.executorAgentId);
    if (!executor) {
      addToast('请先选择可用执行 Agent', 'warning');
      return;
    }

    setIsGenerating(true);
    pushMessage({
      role: 'user',
      content: requirementText,
      created_at: new Date().toISOString(),
    });

    try {
      const response = await generateFlowFromRequirement(
        {
          requirement: requirementText,
          instance_id: executor.instance_id,
          executor_agent_id: selectedAgents.executorAgentId,
          planner_agent_id: selectedAgents.plannerAgentId || selectedAgents.executorAgentId,
          manager_agent_id: selectedAgents.managerAgentId || selectedAgents.executorAgentId,
        },
        { instanceId: executor.instance_id },
        'default'
      );

      setFlowNodes(response.nodes);
      setFlowEdges(response.edges);
      setMessages(response.messages);
      setLastResponse(response);
      addToast(`流程拆解完成：${response.created_task_ids.length} 个任务已入看板`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '流程生成失败';
      pushMessage({
        role: 'system',
        content: `流程生成失败：${message}`,
        created_at: new Date().toISOString(),
      });
      addToast(message, 'error');
    } finally {
      setIsGenerating(false);
    }
  }, [addToast, agentMap, pushMessage, requirement, selectedAgents]);

  const handleClearCanvas = useCallback(() => {
    setFlowNodes([]);
    setFlowEdges([]);
    setLastResponse(null);
    addToast('画布已清空', 'info');
  }, [addToast]);

  return (
    <section style={pageStyle} aria-label="flow-page">
      <header style={headerStyle}>
        <div style={headerTitleGroupStyle}>
          <h2 style={titleStyle}>流程画布</h2>
          <p style={subtitleStyle}>全页面编排视图（Flow Canvas）</p>
        </div>
        <div style={headerActionRowStyle}>
          <button type="button" style={flatButtonStyle} onClick={handleClearCanvas}>
            清空画布
          </button>
          <button type="button" style={flatButtonStyle} onClick={() => navigate('/kanban')}>
            返回看板
          </button>
        </div>
      </header>

      <div style={canvasViewportStyle}>
        <div style={{ ...canvasContentStyle, width: `${canvasSize.width}px`, height: `${canvasSize.height}px` }}>
          <svg width={canvasSize.width} height={canvasSize.height} style={edgeSvgStyle} aria-hidden="true">
            <defs>
              <marker id="flow-arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#0f766e" />
              </marker>
            </defs>
            {flowEdges.map((edge) => {
              const source = nodePositionMap.get(edge.source);
              const target = nodePositionMap.get(edge.target);
              if (!source || !target) {
                return null;
              }
              const x1 = source.x + NODE_WIDTH;
              const y1 = source.y + NODE_HEIGHT / 2;
              const x2 = target.x;
              const y2 = target.y + NODE_HEIGHT / 2;
              const controlX1 = x1 + 80;
              const controlX2 = x2 - 80;
              const path = `M ${x1} ${y1} C ${controlX1} ${y1}, ${controlX2} ${y2}, ${x2} ${y2}`;
              return <path key={edge.id} d={path} stroke="#0f766e" strokeWidth="2" fill="none" markerEnd="url(#flow-arrow)" />;
            })}
          </svg>

          {flowNodes.length === 0 ? (
            <div style={emptyCanvasHintStyle}>
              <p style={emptyCanvasTextStyle}>提交需求后，OpenClaw 专用会话将生成并更新流程图。</p>
            </div>
          ) : (
            flowNodes.map((node) => (
              <article
                key={node.id}
                style={{
                  ...flowNodeCardStyle,
                  left: `${node.x}px`,
                  top: `${node.y}px`,
                  borderColor: node.sensitive ? 'rgba(180, 83, 9, 0.42)' : 'rgba(15, 118, 110, 0.3)',
                  background: node.sensitive
                    ? 'linear-gradient(160deg, rgba(255, 247, 237, 0.94), rgba(255, 251, 235, 0.9))'
                    : 'linear-gradient(160deg, rgba(240, 253, 250, 0.92), rgba(236, 253, 245, 0.88))',
                }}
              >
                <div style={nodeHeaderStyle}>
                  <span style={nodeLayerBadgeStyle}>L{node.layer}</span>
                  <span style={nodeStatusTextStyle}>{node.status}</span>
                </div>
                <h3 style={nodeTitleStyle}>{node.title}</h3>
                <p style={nodeMetaStyle}>Agent：{node.agent_id ?? '待分配'}</p>
              </article>
            ))
          )}
        </div>
      </div>

      <section style={chatDockStyle} aria-label="flow-chat-dock">
        <div style={chatStreamStyle}>
          {messages.length === 0 ? (
            <p style={chatEmptyTextStyle}>消息流为空，提交需求后将展示规划与调度记录。</p>
          ) : (
            messages.map((item, index) => (
              <article
                key={`${item.created_at}-${index}`}
                style={{
                  ...chatItemStyle,
                  borderColor:
                    item.role === 'user'
                      ? 'rgba(14, 116, 144, 0.28)'
                      : item.role === 'assistant'
                        ? 'rgba(15, 118, 110, 0.28)'
                        : 'rgba(148, 163, 184, 0.35)',
                }}
              >
                <div style={chatItemHeaderStyle}>
                  <span style={chatRoleStyle}>{item.role}</span>
                  <span style={chatTimeStyle}>{new Date(item.created_at).toLocaleTimeString('zh-CN')}</span>
                </div>
                <p style={chatContentStyle}>{item.content}</p>
              </article>
            ))
          )}
        </div>

        <div style={chatControlStyle}>
          <div style={agentSelectRowStyle}>
            <label style={agentSelectLabelStyle}>
              规划 Agent
              <select
                value={selectedAgents.plannerAgentId}
                onChange={(event) => setSelectedAgents((prev) => ({ ...prev, plannerAgentId: event.target.value }))}
                style={agentSelectStyle}
              >
                {uniqueAgents.map((agent) => (
                  <option key={`planner-${agent.agent_id}`} value={agent.agent_id}>
                    {agent.agent_name}
                  </option>
                ))}
              </select>
            </label>
            <label style={agentSelectLabelStyle}>
              管理 Agent
              <select
                value={selectedAgents.managerAgentId}
                onChange={(event) => setSelectedAgents((prev) => ({ ...prev, managerAgentId: event.target.value }))}
                style={agentSelectStyle}
              >
                {uniqueAgents.map((agent) => (
                  <option key={`manager-${agent.agent_id}`} value={agent.agent_id}>
                    {agent.agent_name}
                  </option>
                ))}
              </select>
            </label>
            <label style={agentSelectLabelStyle}>
              执行 Agent
              <select
                value={selectedAgents.executorAgentId}
                onChange={(event) => setSelectedAgents((prev) => ({ ...prev, executorAgentId: event.target.value }))}
                style={agentSelectStyle}
              >
                {uniqueAgents.map((agent) => (
                  <option key={`executor-${agent.agent_id}`} value={agent.agent_id}>
                    {agent.agent_name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <textarea
            value={requirement}
            onChange={(event) => setRequirement(event.target.value)}
            placeholder="输入需求，生成流程并自动拆解任务入看板..."
            style={requirementInputStyle}
          />

          {lastResponse ? (
            <div style={sessionMetaStyle}>
              <span>planner session: {lastResponse.planner_session_key}</span>
              <span>manager session: {lastResponse.manager_session_key}</span>
              <span>execution prefix: {lastResponse.execution_session_prefix}</span>
            </div>
          ) : null}

          <div style={chatActionRowStyle}>
            <button type="button" style={primaryButtonStyle} onClick={() => void handleGenerate()} disabled={!canSubmit || isGenerating}>
              {isGenerating ? '生成中...' : '提交需求并生成流程'}
            </button>
            <button type="button" style={flatButtonStyle} onClick={() => navigate('/kanban')}>
              查看看板结果
            </button>
          </div>
        </div>
      </section>
    </section>
  );
}

const pageStyle: React.CSSProperties = {
  position: 'relative',
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.6rem',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.8rem',
};

const headerTitleGroupStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.2rem',
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '1.02rem',
  fontWeight: 700,
  color: '#0f172a',
};

const subtitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.75rem',
  color: '#475569',
};

const headerActionRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.45rem',
};

const canvasViewportStyle: React.CSSProperties = {
  position: 'relative',
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  border: '1px solid rgba(15, 23, 42, 0.1)',
  borderRadius: '0.65rem',
  background:
    'radial-gradient(circle at 30px 30px, rgba(15, 118, 110, 0.08) 1px, transparent 1px), radial-gradient(circle at 30px 30px, rgba(148, 163, 184, 0.07) 0.5px, transparent 0.5px), linear-gradient(160deg, rgba(255, 255, 255, 0.72), rgba(240, 253, 250, 0.6))',
  backgroundSize: '38px 38px, 19px 19px, cover',
};

const canvasContentStyle: React.CSSProperties = {
  position: 'relative',
  minWidth: '100%',
  minHeight: '100%',
};

const edgeSvgStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
};

const flowNodeCardStyle: React.CSSProperties = {
  position: 'absolute',
  width: `${NODE_WIDTH}px`,
  minHeight: `${NODE_HEIGHT}px`,
  border: '1px solid rgba(15, 118, 110, 0.3)',
  borderRadius: '0.6rem',
  padding: '0.55rem',
  boxShadow: '0 10px 30px -24px rgba(15, 23, 42, 0.7)',
  backdropFilter: 'blur(4px)',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.35rem',
};

const nodeHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '0.3rem',
};

const nodeLayerBadgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '999px',
  border: '1px solid rgba(15, 118, 110, 0.28)',
  padding: '0.08rem 0.45rem',
  fontSize: '0.68rem',
  color: '#0f766e',
  fontWeight: 700,
};

const nodeStatusTextStyle: React.CSSProperties = {
  fontSize: '0.68rem',
  color: '#334155',
  fontWeight: 600,
};

const nodeTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  fontWeight: 700,
  color: '#0f172a',
};

const nodeMetaStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.68rem',
  color: '#64748b',
};

const emptyCanvasHintStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const emptyCanvasTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.85rem',
  color: '#64748b',
};

const chatDockStyle: React.CSSProperties = {
  position: 'absolute',
  left: '50%',
  bottom: '1rem',
  transform: 'translateX(-50%)',
  width: 'min(980px, calc(100vw - 2.2rem))',
  maxHeight: 'min(48vh, 430px)',
  display: 'grid',
  gridTemplateRows: 'minmax(120px, 1fr) auto',
  border: '1px solid rgba(15, 23, 42, 0.12)',
  borderRadius: '0.7rem',
  background: 'rgba(255, 255, 255, 0.9)',
  backdropFilter: 'blur(10px)',
  boxShadow: '0 22px 40px -28px rgba(15, 23, 42, 0.8)',
  zIndex: 30,
  overflow: 'hidden',
};

const chatStreamStyle: React.CSSProperties = {
  padding: '0.6rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.4rem',
  overflowY: 'auto',
  borderBottom: '1px solid rgba(148, 163, 184, 0.24)',
};

const chatEmptyTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.78rem',
  color: '#64748b',
};

const chatItemStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.35)',
  borderRadius: '0.55rem',
  padding: '0.44rem 0.5rem',
  background: 'rgba(255, 255, 255, 0.85)',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.22rem',
};

const chatItemHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const chatRoleStyle: React.CSSProperties = {
  fontSize: '0.65rem',
  fontWeight: 700,
  color: '#0f766e',
};

const chatTimeStyle: React.CSSProperties = {
  fontSize: '0.64rem',
  color: '#64748b',
};

const chatContentStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.74rem',
  color: '#334155',
  lineHeight: 1.38,
};

const chatControlStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  padding: '0.6rem',
};

const agentSelectRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: '0.45rem',
};

const agentSelectLabelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.2rem',
  fontSize: '0.7rem',
  color: '#334155',
  fontWeight: 600,
};

const agentSelectStyle: React.CSSProperties = {
  border: '1px solid rgba(15, 23, 42, 0.16)',
  borderRadius: '0.38rem',
  padding: '0.28rem 0.34rem',
  fontSize: '0.74rem',
  background: 'rgba(255, 255, 255, 0.94)',
};

const requirementInputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: '72px',
  border: '1px solid rgba(15, 23, 42, 0.16)',
  borderRadius: '0.42rem',
  padding: '0.48rem 0.56rem',
  fontSize: '0.8rem',
  resize: 'vertical',
  background: 'rgba(255, 255, 255, 0.94)',
};

const sessionMetaStyle: React.CSSProperties = {
  display: 'grid',
  gap: '0.2rem',
  fontSize: '0.68rem',
  color: '#475569',
};

const chatActionRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.45rem',
  flexWrap: 'wrap',
};

const primaryButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(14, 116, 144, 0.52)',
  background: 'linear-gradient(120deg, #0f766e 0%, #0284c7 100%)',
  color: '#f8fafc',
  borderRadius: '0.45rem',
  padding: '0.42rem 0.75rem',
  fontSize: '0.8rem',
  fontWeight: 700,
  cursor: 'pointer',
};

const flatButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(15, 23, 42, 0.16)',
  background: 'rgba(255, 255, 255, 0.8)',
  color: '#1f2937',
  borderRadius: '0.45rem',
  padding: '0.42rem 0.72rem',
  fontSize: '0.8rem',
  fontWeight: 600,
  cursor: 'pointer',
};
