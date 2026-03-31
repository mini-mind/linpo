import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { getAggregateTopology } from '../api/client';
import { listInstances } from '../api/instanceClient';
import type { AggregateTopologyResponse, InstanceItem } from '../api/types';
import { useIsMobile } from '../hooks/useIsMobile';

type InstanceListModalProps = {
  open: boolean;
  onClose: () => void;
};

type AgentTreeItem = {
  agentId: string;
  agentName: string;
  status: string;
  isActive: boolean;
  sessions: Array<{
    sessionKey: string;
    label: string;
    updatedAt: string | null;
  }>;
};

export function InstanceListModal({ open, onClose }: InstanceListModalProps): JSX.Element | null {
  const isMobile = useIsMobile(960);
  const [isLoading, setIsLoading] = useState(false);
  const [instances, setInstances] = useState<InstanceItem[]>([]);
  const [topology, setTopology] = useState<AggregateTopologyResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const selectedInstance = useMemo(
    () => instances.find((item) => item.id === selectedId) ?? null,
    [instances, selectedId]
  );

  const topologyAgents = useMemo<AgentTreeItem[]>(() => {
    if (!selectedInstance || !topology) {
      return [];
    }
    const sessionsByAgent = new Map<string, AgentTreeItem['sessions']>();
    for (const session of topology.sessions) {
      if (session.instance_id !== selectedInstance.id) {
        continue;
      }
      const list = sessionsByAgent.get(session.agent_id) ?? [];
      list.push({
        sessionKey: session.session_key,
        label: session.label,
        updatedAt: session.updated_at,
      });
      sessionsByAgent.set(session.agent_id, list);
    }
    return topology.agents
      .filter((agent) => agent.instance_id === selectedInstance.id)
      .map((agent) => ({
        agentId: agent.agent_id,
        agentName: agent.agent_name,
        status: agent.status,
        isActive: agent.is_active,
        sessions: (sessionsByAgent.get(agent.agent_id) ?? []).sort((a, b) =>
          a.sessionKey.localeCompare(b.sessionKey)
        ),
      }))
      .sort((a, b) => a.agentName.localeCompare(b.agentName));
  }, [selectedInstance, topology]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorText(null);
    try {
      const [instanceList, topologyData] = await Promise.all([listInstances(), getAggregateTopology()]);
      setInstances(instanceList);
      setTopology(topologyData);
      setSelectedId((current) => {
        if (current && instanceList.some((item) => item.id === current)) {
          return current;
        }
        return instanceList[0]?.id ?? null;
      });
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '读取实例数据失败');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    void loadData();
  }, [loadData, open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  const modal = (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="实例列表">
      <div style={backdropStyle} onClick={onClose} aria-hidden="true" />
      <section style={panelStyle}>
        <header style={headerStyle}>
          <div>
            <h3 style={titleStyle}>实例列表</h3>
            <p style={subtitleStyle}>已配对实例与拓扑关系</p>
          </div>
          <div style={headerActionStyle}>
            <button type="button" style={ghostButtonStyle} onClick={() => void loadData()} disabled={isLoading}>
              {isLoading ? '刷新中...' : '刷新'}
            </button>
            <button type="button" style={closeButtonStyle} onClick={onClose} aria-label="关闭实例列表">
              ×
            </button>
          </div>
        </header>

        <div style={getBodyStyle(isMobile)}>
          <aside style={getListStyle(isMobile)}>
            {errorText ? <p style={errorStyle}>{errorText}</p> : null}
            {!errorText && isLoading ? <p style={hintStyle}>加载中...</p> : null}
            {!errorText && !isLoading && instances.length === 0 ? <p style={hintStyle}>暂无实例</p> : null}
            {!errorText && instances.length > 0
              ? instances.map((item) => {
                  const active = selectedId === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      style={getListItemStyle(active)}
                      onClick={() => setSelectedId(item.id)}
                    >
                      <span style={itemNameStyle}>{item.name}</span>
                      <span style={itemMetaStyle}>{item.status}</span>
                    </button>
                  );
                })
              : null}
          </aside>

          <article style={detailStyle}>
            {selectedInstance ? (
              <>
                <h4 style={detailTitleStyle}>{selectedInstance.name}</h4>
                <div style={infoGridStyle}>
                  <p style={infoLineStyle}>
                    <strong>Endpoint：</strong>
                    {selectedInstance.endpoint}
                  </p>
                  <p style={infoLineStyle}>
                    <strong>状态：</strong>
                    {selectedInstance.status}
                  </p>
                  <p style={infoLineStyle}>
                    <strong>最近检查：</strong>
                    {selectedInstance.last_check_at ?? '暂无'}
                  </p>
                  <p style={infoLineStyle}>
                    <strong>创建时间：</strong>
                    {selectedInstance.created_at}
                  </p>
                </div>

                <div style={treeWrapStyle}>
                  <p style={treeTitleStyle}>拓扑</p>
                  {topologyAgents.length === 0 ? (
                    <p style={hintStyle}>当前实例暂无 Agent 或 Session</p>
                  ) : (
                    <ul style={treeRootListStyle}>
                      <li style={treeItemStyle}>
                        <div style={treeInstanceNodeStyle}>
                          <span>实例</span>
                          <strong>{selectedInstance.name}</strong>
                        </div>
                        <ul style={treeChildListStyle}>
                          {topologyAgents.map((agent) => (
                            <li key={agent.agentId} style={treeItemStyle}>
                              <div style={treeAgentNodeStyle}>
                                <span>Agent · {agent.agentName || agent.agentId}</span>
                                <span style={treeMetaStyle}>
                                  {agent.isActive ? '活跃' : agent.status} · {agent.sessions.length} 会话
                                </span>
                              </div>
                              {agent.sessions.length > 0 ? (
                                <ul style={treeChildListStyle}>
                                  {agent.sessions.map((session) => (
                                    <li key={session.sessionKey} style={treeItemStyle}>
                                      <div style={treeSessionNodeStyle}>
                                        <span>Session · {session.label || session.sessionKey}</span>
                                        <span style={treeMetaStyle}>
                                          {session.updatedAt ? `更新于 ${session.updatedAt}` : '暂无更新时间'}
                                        </span>
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p style={hintStyle}>该 Agent 暂无 Session</p>
                              )}
                            </li>
                          ))}
                        </ul>
                      </li>
                    </ul>
                  )}
                </div>
              </>
            ) : (
              <p style={hintStyle}>请选择实例查看详情</p>
            )}
          </article>
        </div>
      </section>
    </div>
  );

  if (typeof document === 'undefined' || !document.body) {
    return modal;
  }
  return createPortal(modal, document.body);
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 240,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  paddingTop: '56px',
};

const backdropStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.26)',
};

const panelStyle: React.CSSProperties = {
  position: 'relative',
  zIndex: 1,
  width: 'min(980px, calc(100% - 1.2rem))',
  height: 'min(680px, calc(100% - 1rem))',
  borderRadius: '0.9rem',
  border: '1px solid rgba(148, 163, 184, 0.38)',
  background: 'rgba(255, 255, 255, 0.97)',
  boxShadow: '0 30px 64px -40px rgba(15, 23, 42, 0.52)',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
};

const headerStyle: React.CSSProperties = {
  padding: '0.78rem 0.92rem',
  borderBottom: '1px solid rgba(148, 163, 184, 0.3)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.8rem',
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.92rem',
  color: '#0f172a',
};

const subtitleStyle: React.CSSProperties = {
  margin: '0.24rem 0 0',
  fontSize: '0.76rem',
  color: '#64748b',
};

const headerActionStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.45rem',
};

const ghostButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.45)',
  borderRadius: '0.45rem',
  background: '#f8fafc',
  color: '#334155',
  fontSize: '0.76rem',
  padding: '0.36rem 0.56rem',
  cursor: 'pointer',
};

const closeButtonStyle: React.CSSProperties = {
  width: '1.85rem',
  height: '1.85rem',
  borderRadius: '0.45rem',
  border: '1px solid rgba(148, 163, 184, 0.45)',
  background: '#fff',
  color: '#334155',
  cursor: 'pointer',
  fontSize: '1rem',
  lineHeight: 1,
};

function getBodyStyle(isMobile: boolean): React.CSSProperties {
  return {
    flex: 1,
    minHeight: 0,
    display: 'grid',
    gridTemplateColumns: isMobile ? '1fr' : 'minmax(240px, 280px) 1fr',
  };
}

function getListStyle(isMobile: boolean): React.CSSProperties {
  return {
    borderRight: isMobile ? 'none' : '1px solid rgba(148, 163, 184, 0.3)',
    borderBottom: isMobile ? '1px solid rgba(148, 163, 184, 0.3)' : 'none',
    padding: '0.55rem',
    overflowY: 'auto',
    maxHeight: isMobile ? '35vh' : 'none',
    background: 'rgba(248, 250, 252, 0.76)',
  };
}

function getListItemStyle(active: boolean): React.CSSProperties {
  return {
    width: '100%',
    border: active ? '1px solid rgba(15, 118, 110, 0.58)' : '1px solid rgba(203, 213, 225, 0.72)',
    background: active ? 'rgba(236, 253, 245, 0.85)' : '#fff',
    borderRadius: '0.55rem',
    padding: '0.54rem',
    marginBottom: '0.42rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5rem',
    cursor: 'pointer',
    textAlign: 'left',
  };
}

const itemNameStyle: React.CSSProperties = {
  fontSize: '0.82rem',
  fontWeight: 600,
  color: '#0f172a',
};

const itemMetaStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  color: '#64748b',
};

const detailStyle: React.CSSProperties = {
  minHeight: 0,
  overflowY: 'auto',
  padding: '0.9rem',
};

const detailTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.96rem',
  color: '#0f172a',
  fontWeight: 700,
};

const infoGridStyle: React.CSSProperties = {
  marginTop: '0.64rem',
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: '0.45rem 0.72rem',
};

const infoLineStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.78rem',
  color: '#334155',
  wordBreak: 'break-all',
};

const treeWrapStyle: React.CSSProperties = {
  marginTop: '0.82rem',
  border: '1px dashed rgba(148, 163, 184, 0.45)',
  borderRadius: '0.62rem',
  padding: '0.62rem',
  background: 'rgba(255, 255, 255, 0.95)',
};

const treeTitleStyle: React.CSSProperties = {
  margin: '0 0 0.5rem',
  fontSize: '0.78rem',
  fontWeight: 700,
  color: '#334155',
};

const treeRootListStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: '1rem',
};

const treeChildListStyle: React.CSSProperties = {
  margin: '0.35rem 0 0',
  paddingLeft: '1rem',
};

const treeItemStyle: React.CSSProperties = {
  marginBottom: '0.34rem',
};

const treeInstanceNodeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.42rem',
  borderRadius: '0.45rem',
  border: '1px solid rgba(14, 116, 144, 0.3)',
  background: 'rgba(224, 242, 254, 0.72)',
  padding: '0.32rem 0.45rem',
  fontSize: '0.76rem',
  color: '#0c4a6e',
};

const treeAgentNodeStyle: React.CSSProperties = {
  display: 'inline-flex',
  flexWrap: 'wrap',
  gap: '0.5rem',
  alignItems: 'center',
  borderRadius: '0.42rem',
  border: '1px solid rgba(148, 163, 184, 0.3)',
  background: 'rgba(248, 250, 252, 0.88)',
  padding: '0.3rem 0.44rem',
  fontSize: '0.74rem',
  color: '#1e293b',
};

const treeSessionNodeStyle: React.CSSProperties = {
  display: 'inline-flex',
  flexWrap: 'wrap',
  gap: '0.5rem',
  alignItems: 'center',
  borderRadius: '0.4rem',
  border: '1px solid rgba(203, 213, 225, 0.45)',
  background: '#fff',
  padding: '0.28rem 0.42rem',
  fontSize: '0.72rem',
  color: '#334155',
};

const treeMetaStyle: React.CSSProperties = {
  color: '#64748b',
  fontSize: '0.68rem',
};

const hintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  color: '#64748b',
};

const errorStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  color: '#b91c1c',
};
