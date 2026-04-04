import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { getAggregateTopology } from '../api/client';
import {
  createPairingSession,
  createInstance,
  getPairingSession,
  listInstances,
  validateInstance,
} from '../api/instanceClient';
import type { AggregateTopologyResponse, InstanceItem, PairingSession } from '../api/types';
import { useIsMobile } from '../hooks/useIsMobile';
import { useToast } from '../hooks/useToast';

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

type InstanceModalTab =
  | { kind: 'create' }
  | { kind: 'instance'; instanceId: string };

type CreateMode = 'pairing_session' | 'token';

function formatBeijingTime(isoText: string | null | undefined): string {
  if (!isoText) {
    return '';
  }
  const value = new Date(isoText);
  if (Number.isNaN(value.getTime())) {
    return isoText;
  }
  return `${new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(value)}（北京时间 UTC+8）`;
}

export function InstanceListModal({ open, onClose }: InstanceListModalProps): JSX.Element | null {
  const isMobile = useIsMobile(960);
  const { addToast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [instances, setInstances] = useState<InstanceItem[]>([]);
  const [topology, setTopology] = useState<AggregateTopologyResponse | null>(null);
  const [selectedTab, setSelectedTab] = useState<InstanceModalTab>({ kind: 'create' });
  const [errorText, setErrorText] = useState<string | null>(null);
  const [createMode, setCreateMode] = useState<CreateMode>('pairing_session');
  const [createName, setCreateName] = useState('claw2');
  const [createEndpoint, setCreateEndpoint] = useState('');
  const [createToken, setCreateToken] = useState('');
  const [createHintText, setCreateHintText] = useState('');
  const [tokenValidationText, setTokenValidationText] = useState('');
  const [pairingSession, setPairingSession] = useState<PairingSession | null>(null);
  const openClawAttachInstruction = useMemo(() => {
    if (!pairingSession?.shortCode) {
      return '';
    }
    return [
      '请调用以下 Linpo API 完成一键绑定：',
      `POST ${window.location.origin}/api/v1/instances/pairing-sessions/attach-by-code`,
      'Content-Type: application/json',
      '',
      JSON.stringify(
        {
          shortCode: pairingSession.shortCode,
          name: createName.trim() || 'claw2',
          endpoint: '<OpenClaw endpoint>',
          gatewayToken: '<OpenClaw gateway token>',
        },
        null,
        2
      ),
    ].join('\n');
  }, [createName, pairingSession?.shortCode]);

  const clearCreateState = useCallback(() => {
    setCreateHintText('');
    setTokenValidationText('');
    setPairingSession(null);
  }, []);

  const handleCreatePairingSession = useCallback(async () => {
    if (!createName.trim()) {
      setCreateHintText('请填写实例名');
      addToast('请填写实例名', 'warning');
      return;
    }
    setIsCreating(true);
    clearCreateState();
    try {
      const created = await createPairingSession({
        name: createName.trim(),
        expSeconds: 600,
      });
      setPairingSession(created);
      setCreateHintText('配对会话已创建，请在 OpenClaw 侧完成 attach');
      addToast('配对会话已创建', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '创建配对会话失败';
      setCreateHintText(message);
      addToast(message, 'error');
    } finally {
      setIsCreating(false);
    }
  }, [addToast, clearCreateState, createName]);

  const selectedInstance = useMemo(
    () => (selectedTab.kind === 'instance' ? instances.find((item) => item.id === selectedTab.instanceId) ?? null : null),
    [instances, selectedTab]
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

  const loadData = useCallback(async (): Promise<InstanceItem[]> => {
    setIsLoading(true);
    setErrorText(null);
    try {
      const [instanceList, topologyData] = await Promise.all([listInstances(), getAggregateTopology()]);
      setInstances(instanceList);
      setTopology(topologyData);
      setSelectedTab((current) => {
        if (current.kind === 'instance' && instanceList.some((item) => item.id === current.instanceId)) {
          return current;
        }
        if (current.kind === 'create' && instanceList.length === 0) {
          return current;
        }
        return instanceList[0] ? { kind: 'instance', instanceId: instanceList[0].id } : { kind: 'create' };
      });
      return instanceList;
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '读取实例数据失败');
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleCreateByToken = useCallback(async () => {
    if (!createName.trim() || !createEndpoint.trim() || !createToken.trim()) {
      setCreateHintText('请填写实例名、endpoint 和 token');
      addToast('请填写实例名、endpoint 和 token', 'warning');
      return;
    }
    setIsCreating(true);
    clearCreateState();
    try {
      const created = await createInstance({
        name: createName.trim(),
        type: 'openclaw',
        endpoint: createEndpoint.trim(),
        gatewayToken: createToken.trim(),
      });
      setCreateToken('');
      setCreateHintText(`创建成功：${created.name}`);
      addToast(`创建成功：${created.name}`, 'success');
      await loadData();
      setSelectedTab({ kind: 'instance', instanceId: created.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : '创建实例失败';
      setCreateHintText(message);
      addToast(message, 'error');
    } finally {
      setIsCreating(false);
    }
  }, [addToast, clearCreateState, createEndpoint, createName, createToken, loadData]);

  const handleValidateByToken = useCallback(async () => {
    if (!createName.trim() || !createEndpoint.trim() || !createToken.trim()) {
      setTokenValidationText('请填写实例名、endpoint 和 token');
      addToast('请填写实例名、endpoint 和 token', 'warning');
      return;
    }
    setIsValidating(true);
    setTokenValidationText('');
    try {
      const result = await validateInstance({
        name: createName.trim(),
        type: 'openclaw',
        endpoint: createEndpoint.trim(),
        gatewayToken: createToken.trim(),
      });
      const message = result.message || '连接测试通过';
      setTokenValidationText(message);
      addToast(message, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '连接测试失败';
      setTokenValidationText(message);
      addToast(message, 'error');
    } finally {
      setIsValidating(false);
    }
  }, [addToast, createEndpoint, createName, createToken]);

  useEffect(() => {
    if (!open) {
      return;
    }
    void loadData();
  }, [loadData, open]);

  useEffect(() => {
    if (!open || createMode !== 'pairing_session' || !pairingSession?.sessionId) {
      return;
    }
    if (!['pending', 'attached'].includes(pairingSession.status)) {
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const latest = await getPairingSession(pairingSession.sessionId);
        if (cancelled) {
          return;
        }
        setPairingSession(latest);
        if (latest.status === 'bound') {
          const refreshed = await loadData();
          if (cancelled) {
            return;
          }
          const targetInstanceId = latest.instanceId ?? latest.instance?.id ?? null;
          if (targetInstanceId && refreshed.some((item) => item.id === targetInstanceId)) {
            setSelectedTab({ kind: 'instance', instanceId: targetInstanceId });
          }
          setCreateHintText('配对成功，实例已自动绑定');
          addToast('配对成功，已切换到新实例', 'success');
        } else if (latest.status === 'expired' || latest.status === 'failed') {
          setCreateHintText(`配对会话已${latest.status === 'expired' ? '过期' : '失败'}，请重新创建`);
        }
      } catch (error) {
        if (!cancelled) {
          setCreateHintText(error instanceof Error ? error.message : '轮询配对会话失败');
        }
      }
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [addToast, createMode, loadData, open, pairingSession]);

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
            <button
              type="button"
              style={getListItemStyle(selectedTab.kind === 'create')}
              onClick={() => setSelectedTab({ kind: 'create' })}
              aria-label="添加实例"
            >
              <span style={itemNameStyle}>添加实例</span>
              <span style={itemMetaStyle}>表单</span>
            </button>
            {errorText ? <p style={errorStyle}>{errorText}</p> : null}
            {!errorText && isLoading ? <p style={hintStyle}>加载中...</p> : null}
            {!errorText && !isLoading && instances.length === 0 ? <p style={hintStyle}>暂无实例</p> : null}
            {!errorText && instances.length > 0
              ? instances.map((item) => {
                  const active = selectedTab.kind === 'instance' && selectedTab.instanceId === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      style={getListItemStyle(active)}
                      onClick={() => setSelectedTab({ kind: 'instance', instanceId: item.id })}
                    >
                      <span style={itemNameStyle}>{item.name}</span>
                      <span style={itemMetaStyle}>{item.status}</span>
                    </button>
                  );
                })
              : null}
          </aside>

          <article style={detailStyle}>
            {selectedTab.kind === 'create' ? (
              <>
                <h4 style={detailTitleStyle}>添加实例</h4>
                <section style={createCardStyle} aria-label="添加实例表单">
                  <div style={createTabRowStyle} role="tablist" aria-label="添加方式">
                    <button
                      type="button"
                      style={getCreateTabButtonStyle(createMode === 'pairing_session')}
                      role="tab"
                      aria-selected={createMode === 'pairing_session'}
                      onClick={() => {
                        setCreateMode('pairing_session');
                        clearCreateState();
                      }}
                    >
                      配对会话
                    </button>
                    <button
                      type="button"
                      style={getCreateTabButtonStyle(createMode === 'token')}
                      role="tab"
                      aria-selected={createMode === 'token'}
                      onClick={() => {
                        setCreateMode('token');
                        clearCreateState();
                      }}
                    >
                      Token
                    </button>
                  </div>
                  <label style={fieldLabelStyle}>
                    实例名称
                    <input
                      value={createName}
                      onChange={(event) => setCreateName(event.target.value)}
                      placeholder="例如 claw2"
                      style={inputStyle}
                      disabled={isCreating || isValidating}
                    />
                  </label>
                  {createMode === 'pairing_session' ? (
                    <>
                      {pairingSession ? (
                        <>
                          <label style={fieldLabelStyle}>
                            给 OpenClaw 的一键指令
                            <textarea value={openClawAttachInstruction} readOnly style={instructionTextareaStyle} />
                          </label>
                          <p style={hintStyle}>状态：{pairingSession.status}</p>
                          {pairingSession.expiresAt ? (
                            <p style={hintStyle}>过期时间：{formatBeijingTime(pairingSession.expiresAt)}</p>
                          ) : null}
                          <div style={createActionRowStyle}>
                            <button
                              type="button"
                              style={ghostButtonStyle}
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(openClawAttachInstruction);
                                  addToast('一键指令已复制', 'success');
                                } catch {
                                  addToast('复制失败，请手动复制', 'error');
                                }
                              }}
                            >
                              复制一键指令
                            </button>
                            <button
                              type="button"
                              style={createButtonStyle}
                              onClick={() => void handleCreatePairingSession()}
                              disabled={isCreating || isValidating}
                            >
                              {isCreating ? '创建中...' : '重新创建会话'}
                            </button>
                          </div>
                        </>
                      ) : (
                        <div style={createActionRowStyle}>
                          <button
                            type="button"
                            style={createButtonStyle}
                            onClick={() => void handleCreatePairingSession()}
                            disabled={isCreating || isValidating}
                          >
                            {isCreating ? '创建中...' : '创建配对会话'}
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <label style={fieldLabelStyle}>
                        OpenClaw Endpoint
                        <input
                          value={createEndpoint}
                          onChange={(event) => setCreateEndpoint(event.target.value)}
                          placeholder="http://127.0.0.1:28789"
                          style={inputStyle}
                          disabled={isCreating || isValidating}
                        />
                      </label>
                      <label style={fieldLabelStyle}>
                        Gateway Token
                        <input
                          value={createToken}
                          onChange={(event) => setCreateToken(event.target.value)}
                          placeholder="从 OpenClaw 对话复制 token"
                          style={inputStyle}
                          disabled={isCreating || isValidating}
                        />
                      </label>
                      {tokenValidationText ? <p style={hintStyle}>{tokenValidationText}</p> : null}
                      <div style={createActionRowStyle}>
                        <button
                          type="button"
                          style={ghostButtonStyle}
                          onClick={() => void handleValidateByToken()}
                          disabled={isCreating || isValidating}
                        >
                          {isValidating ? '测试中...' : '测试连接'}
                        </button>
                        <button
                          type="button"
                          style={createButtonStyle}
                          onClick={() => void handleCreateByToken()}
                          disabled={isCreating || isValidating}
                        >
                          {isCreating ? '创建中...' : '创建实例'}
                        </button>
                      </div>
                    </>
                  )}
                  {createHintText ? <p style={hintStyle}>{createHintText}</p> : null}
                </section>
                <section style={treeWrapStyle} aria-label="添加实例教程">
                  <p style={treeTitleStyle}>教程</p>
                  <p style={hintStyle}>1. 默认使用「配对会话」：创建会话后复制“一键指令”给 OpenClaw 执行 attach。</p>
                  <p style={hintStyle}>2. Linpo 会自动轮询会话状态，变为 bound 后自动刷新实例并切换到新实例。</p>
                  <p style={hintStyle}>3. 若会话方式不可用，可切换到 Token 方式直接创建实例。</p>
                </section>
              </>
            ) : selectedInstance ? (
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

const createCardStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.32)',
  borderRadius: '0.55rem',
  padding: '0.52rem',
  marginBottom: '0.55rem',
  background: 'rgba(255, 255, 255, 0.9)',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.42rem',
};

const createTabRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.32rem',
  marginBottom: '0.14rem',
};

function getCreateTabButtonStyle(active: boolean): React.CSSProperties {
  return {
    border: active ? '1px solid rgba(15, 118, 110, 0.55)' : '1px solid rgba(148, 163, 184, 0.42)',
    borderRadius: '0.42rem',
    background: active ? 'rgba(236, 253, 245, 0.88)' : 'rgba(248, 250, 252, 0.94)',
    color: active ? '#0f766e' : '#334155',
    fontSize: '0.73rem',
    fontWeight: active ? 700 : 600,
    padding: '0.3rem 0.54rem',
    cursor: 'pointer',
  };
}

const fieldLabelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.2rem',
  fontSize: '0.72rem',
  color: '#334155',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid rgba(148, 163, 184, 0.45)',
  borderRadius: '0.42rem',
  background: '#fff',
  color: '#0f172a',
  padding: '0.36rem 0.45rem',
  fontSize: '0.74rem',
};

const instructionTextareaStyle: React.CSSProperties = {
  ...inputStyle,
  minHeight: '8.4rem',
  resize: 'vertical',
  lineHeight: 1.45,
  fontFamily: '"JetBrains Mono", "Fira Code", "Menlo", monospace',
};

const createButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(14, 116, 144, 0.42)',
  borderRadius: '0.42rem',
  background: 'linear-gradient(120deg, #0f766e 0%, #0284c7 100%)',
  color: '#f8fafc',
  fontSize: '0.76rem',
  fontWeight: 700,
  padding: '0.4rem 0.62rem',
  cursor: 'pointer',
};

const createActionRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.42rem',
  flexWrap: 'wrap',
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
