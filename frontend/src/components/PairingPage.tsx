import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createInstance,
  createInstanceByPairCode,
  deleteInstance,
  listInstances,
  validateInstance,
  validateInstanceByPairCode,
} from '../api/instanceClient';
import { getAggregateTopology } from '../api/client';
import type { AggregateTopologyResponse, InstanceItem } from '../api/types';
import { useCurrentInstanceId } from '../hooks/useCurrentInstance';
import { useIsMobile } from '../hooks/useIsMobile';
import { useToast } from '../hooks/useToast';

type CreateTab = 'token' | 'pair_code' | 'openclaw_auto' | 'tutorial_link';
type PanelState =
  | { kind: 'new' }
  | { kind: 'instance'; instanceId: string };

interface InstanceTreeSessionItem {
  sessionKey: string;
  label: string;
  updatedAt: string | null;
}

interface InstanceTreeAgentItem {
  agentId: string;
  agentName: string;
  status: string;
  isActive: boolean;
  sessions: InstanceTreeSessionItem[];
}

const DEFAULT_INSTANCE_NAME = 'claw2';
const DEFAULT_ENDPOINT = 'http://127.0.0.1:28789';

export function PairingPage(): JSX.Element {
  const isMobile = useIsMobile(960);
  const { addToast } = useToast();
  const [currentInstanceId, setCurrentInstanceId] = useCurrentInstanceId();
  const [instances, setInstances] = useState<InstanceItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isTopologyLoading, setIsTopologyLoading] = useState(false);
  const [panel, setPanel] = useState<PanelState>({ kind: 'new' });
  const [createTab, setCreateTab] = useState<CreateTab>('token');
  const [topology, setTopology] = useState<AggregateTopologyResponse | null>(null);
  const [topologyError, setTopologyError] = useState<string | null>(null);

  const [tokenName, setTokenName] = useState(DEFAULT_INSTANCE_NAME);
  const [tokenEndpoint, setTokenEndpoint] = useState(DEFAULT_ENDPOINT);
  const [tokenGatewayToken, setTokenGatewayToken] = useState('');
  const [tokenValidationText, setTokenValidationText] = useState('');

  const [pairCodeName, setPairCodeName] = useState(DEFAULT_INSTANCE_NAME);
  const [pairCode, setPairCode] = useState('');
  const [pairCodeValidationText, setPairCodeValidationText] = useState('');
  const tutorialLink = useMemo(() => `${window.location.origin}/pairing/tutorial.md`, []);
  const openClawAutoPrompt = useMemo(() => buildOpenClawAutoPrompt(tutorialLink), [tutorialLink]);

  const sortedInstances = useMemo(
    () =>
      [...instances].sort((left, right) => {
        const leftTs = Date.parse(left.created_at);
        const rightTs = Date.parse(right.created_at);
        return (Number.isFinite(rightTs) ? rightTs : 0) - (Number.isFinite(leftTs) ? leftTs : 0);
      }),
    [instances]
  );

  const selectedInstance = useMemo(() => {
    if (panel.kind !== 'instance') {
      return null;
    }
    return sortedInstances.find((item) => item.id === panel.instanceId) ?? null;
  }, [panel, sortedInstances]);

  const topologyDiagnostic = useMemo(() => {
    if (!selectedInstance || !topology) {
      return null;
    }
    return topology.diagnostics.find((item) => item.instance_id === selectedInstance.id) ?? null;
  }, [selectedInstance, topology]);

  const topologyAgents = useMemo<InstanceTreeAgentItem[]>(() => {
    if (!selectedInstance || !topology) {
      return [];
    }
    const instanceId = selectedInstance.id;
    const sessionsByAgent = new Map<string, InstanceTreeSessionItem[]>();
    for (const session of topology.sessions) {
      if (session.instance_id !== instanceId) {
        continue;
      }
      const current = sessionsByAgent.get(session.agent_id) ?? [];
      current.push({
        sessionKey: session.session_key,
        label: session.label,
        updatedAt: session.updated_at,
      });
      sessionsByAgent.set(session.agent_id, current);
    }
    return topology.agents
      .filter((item) => item.instance_id === instanceId)
      .map((agent) => ({
        agentId: agent.agent_id,
        agentName: agent.agent_name,
        status: agent.status,
        isActive: agent.is_active,
        sessions: [...(sessionsByAgent.get(agent.agent_id) ?? [])].sort((left, right) =>
          left.sessionKey.localeCompare(right.sessionKey)
        ),
      }))
      .sort((left, right) => left.agentName.localeCompare(right.agentName));
  }, [selectedInstance, topology]);
  const resolvedWorkspaceStyle = isMobile ? workspaceStyleMobile : workspaceStyle;
  const resolvedTabBodyLayoutStyle = isMobile ? tabBodyLayoutStyleMobile : tabBodyLayoutStyle;

  const reloadInstances = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await listInstances();
      setInstances(list);
      setPanel((current) => {
        if (current.kind === 'instance' && list.some((item) => item.id === current.instanceId)) {
          return current;
        }
        if (list.length > 0) {
          return { kind: 'instance', instanceId: list[0].id };
        }
        return { kind: 'new' };
      });
      if (!currentInstanceId && list.length > 0) {
        setCurrentInstanceId(list[0].id);
      }
    } catch (error) {
      addToast(error instanceof Error ? error.message : '读取实例列表失败', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [addToast, currentInstanceId, setCurrentInstanceId]);

  useEffect(() => {
    void reloadInstances();
  }, [reloadInstances]);

  const reloadTopology = useCallback(async () => {
    setIsTopologyLoading(true);
    setTopologyError(null);
    try {
      const data = await getAggregateTopology();
      setTopology(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取拓扑失败';
      setTopologyError(message);
    } finally {
      setIsTopologyLoading(false);
    }
  }, []);

  useEffect(() => {
    if (panel.kind !== 'instance') {
      return;
    }
    void reloadTopology();
  }, [panel, reloadTopology]);

  const handleValidateToken = useCallback(async () => {
    if (!tokenName.trim() || !tokenEndpoint.trim() || !tokenGatewayToken.trim()) {
      addToast('请先填写实例名、endpoint 和 token', 'warning');
      return;
    }
    setIsValidating(true);
    setTokenValidationText('');
    try {
      const result = await validateInstance({
        name: tokenName.trim(),
        type: 'openclaw',
        endpoint: tokenEndpoint.trim(),
        gatewayToken: tokenGatewayToken.trim(),
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
  }, [addToast, tokenEndpoint, tokenGatewayToken, tokenName]);

  const handleCreateByToken = useCallback(async () => {
    if (!tokenName.trim() || !tokenEndpoint.trim() || !tokenGatewayToken.trim()) {
      addToast('请先填写实例名、endpoint 和 token', 'warning');
      return;
    }
    setIsSubmitting(true);
    try {
      const created = await createInstance({
        name: tokenName.trim(),
        type: 'openclaw',
        endpoint: tokenEndpoint.trim(),
        gatewayToken: tokenGatewayToken.trim(),
      });
      setTokenGatewayToken('');
      setCurrentInstanceId(created.id);
      addToast(`创建成功：${created.name}`, 'success');
      await reloadInstances();
    } catch (error) {
      addToast(error instanceof Error ? error.message : '创建实例失败', 'error');
    } finally {
      setIsSubmitting(false);
    }
  }, [addToast, reloadInstances, setCurrentInstanceId, tokenEndpoint, tokenGatewayToken, tokenName]);

  const handleValidatePairCode = useCallback(async () => {
    if (!pairCodeName.trim() || !pairCode.trim()) {
      addToast('请先填写实例名和配对码', 'warning');
      return;
    }
    setIsValidating(true);
    setPairCodeValidationText('');
    try {
      const result = await validateInstanceByPairCode({
        name: pairCodeName.trim(),
        type: 'openclaw',
        pairCode: pairCode.trim(),
      });
      const message = result.message || '配对码校验通过';
      setPairCodeValidationText(message);
      addToast(message, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '配对码校验失败';
      setPairCodeValidationText(message);
      addToast(message, 'error');
    } finally {
      setIsValidating(false);
    }
  }, [addToast, pairCode, pairCodeName]);

  const handleCreateByPairCode = useCallback(async () => {
    if (!pairCodeName.trim() || !pairCode.trim()) {
      addToast('请先填写实例名和配对码', 'warning');
      return;
    }
    setIsSubmitting(true);
    try {
      const created = await createInstanceByPairCode({
        name: pairCodeName.trim(),
        type: 'openclaw',
        pairCode: pairCode.trim(),
      });
      setPairCode('');
      setCurrentInstanceId(created.id);
      addToast(`创建成功：${created.name}`, 'success');
      await reloadInstances();
    } catch (error) {
      addToast(error instanceof Error ? error.message : '配对码创建失败', 'error');
    } finally {
      setIsSubmitting(false);
    }
  }, [addToast, pairCode, pairCodeName, reloadInstances, setCurrentInstanceId]);

  const handleDelete = useCallback(
    async (instance: InstanceItem) => {
      const accepted = window.confirm(`确认删除实例 ${instance.name} 吗？`);
      if (!accepted) {
        return;
      }
      try {
        await deleteInstance(instance.id);
        if (currentInstanceId === instance.id) {
          setCurrentInstanceId(null);
        }
        addToast(`已删除 ${instance.name}`, 'success');
        await reloadInstances();
      } catch (error) {
        addToast(error instanceof Error ? error.message : '删除实例失败', 'error');
      }
    },
    [addToast, currentInstanceId, reloadInstances, setCurrentInstanceId]
  );

  const handleCopyTutorialLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(tutorialLink);
      addToast('教程链接已复制', 'success');
    } catch {
      addToast('复制失败，请手动复制链接', 'error');
    }
  }, [addToast, tutorialLink]);

  const handleCopyOpenClawAutoPrompt = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(openClawAutoPrompt);
      addToast('自动接入指令已复制', 'success');
    } catch {
      addToast('复制失败，请手动复制指令', 'error');
    }
  }, [addToast, openClawAutoPrompt]);

  return (
    <section style={pageStyle} aria-label="instances-page">
      <header style={toolbarStyle} role="toolbar" aria-label="实例工具栏">
        <div style={toolbarTitleBlockStyle}>
          <h2 style={titleStyle}>实例</h2>
          <p style={subtitleStyle}>管理 OpenClaw 实例接入与默认上下文</p>
        </div>
      </header>

      <div style={resolvedWorkspaceStyle}>
        <aside style={sidebarStyle} aria-label="实例侧边栏">
          <button
            type="button"
            style={{
              ...newPairingButtonStyle,
              ...(panel.kind === 'new' ? newPairingButtonActiveStyle : null),
            }}
            onClick={() => setPanel({ kind: 'new' })}
          >
            新建配对
          </button>
          <div style={sidebarListWrapStyle}>
            <p style={sidebarSectionTitleStyle}>已配对实例</p>
            {isLoading ? <p style={hintTextStyle}>加载中...</p> : null}
            {!isLoading && sortedInstances.length === 0 ? <p style={hintTextStyle}>暂无实例</p> : null}
            {!isLoading && sortedInstances.length > 0 ? (
              <ul style={sidebarListStyle}>
                {sortedInstances.map((item) => {
                  const isSelected = panel.kind === 'instance' && panel.instanceId === item.id;
                  const isCurrent = currentInstanceId === item.id;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        style={{
                          ...instanceListItemButtonStyle,
                          ...(isSelected ? instanceListItemButtonActiveStyle : null),
                        }}
                        onClick={() => setPanel({ kind: 'instance', instanceId: item.id })}
                      >
                        <span style={instanceListItemNameStyle}>{item.name}</span>
                        <span style={instanceListItemMetaStyle}>{isCurrent ? '当前实例' : item.status}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        </aside>

        <section style={mainStageStyle}>
          {panel.kind === 'new' ? (
            <article style={cardStyle} aria-label="新建实例配对">
              <div style={tabsRowStyle} role="tablist" aria-label="配对方式">
                <button
                  type="button"
                  role="tab"
                  aria-selected={createTab === 'token'}
                  style={{
                    ...tabButtonStyle,
                    ...(createTab === 'token' ? tabButtonActiveStyle : null),
                  }}
                  onClick={() => setCreateTab('token')}
                >
                  Token 配对
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={createTab === 'pair_code'}
                  style={{
                    ...tabButtonStyle,
                    ...(createTab === 'pair_code' ? tabButtonActiveStyle : null),
                  }}
                  onClick={() => setCreateTab('pair_code')}
                >
                  配对码配对
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={createTab === 'openclaw_auto'}
                  style={{
                    ...tabButtonStyle,
                    ...(createTab === 'openclaw_auto' ? tabButtonActiveStyle : null),
                  }}
                  onClick={() => setCreateTab('openclaw_auto')}
                >
                  OpenClaw 自动接入
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={createTab === 'tutorial_link'}
                  style={{
                    ...tabButtonStyle,
                    ...(createTab === 'tutorial_link' ? tabButtonActiveStyle : null),
                  }}
                  onClick={() => setCreateTab('tutorial_link')}
                >
                  教程链接配对
                </button>
              </div>

              {createTab === 'token' ? (
                <div style={resolvedTabBodyLayoutStyle}>
                  <div style={tabFormPanelStyle}>
                    <label style={fieldStyle}>
                      <span style={labelStyle}>实例名称</span>
                      <input
                        value={tokenName}
                        onChange={(event) => setTokenName(event.target.value)}
                        placeholder="例如 claw2"
                        style={inputStyle}
                        disabled={isSubmitting || isValidating}
                      />
                    </label>
                    <label style={fieldStyle}>
                      <span style={labelStyle}>OpenClaw Endpoint</span>
                      <input
                        value={tokenEndpoint}
                        onChange={(event) => setTokenEndpoint(event.target.value)}
                        placeholder="http://127.0.0.1:28789"
                        style={inputStyle}
                        disabled={isSubmitting || isValidating}
                      />
                    </label>
                    <label style={fieldStyle}>
                      <span style={labelStyle}>Gateway Token</span>
                      <input
                        type="password"
                        value={tokenGatewayToken}
                        onChange={(event) => setTokenGatewayToken(event.target.value)}
                        placeholder="从 OpenClaw 对话复制 token"
                        style={inputStyle}
                        disabled={isSubmitting || isValidating}
                      />
                    </label>
                    {tokenValidationText ? <p style={hintTextStyle}>{tokenValidationText}</p> : null}
                    <div style={actionRowStyle}>
                      <button
                        type="button"
                        style={ghostButtonStyle}
                        onClick={() => void handleValidateToken()}
                        disabled={isSubmitting || isValidating}
                      >
                        {isValidating ? '测试中...' : '测试连接'}
                      </button>
                      <button
                        type="button"
                        style={primaryButtonStyle}
                        onClick={() => void handleCreateByToken()}
                        disabled={isSubmitting || isValidating}
                      >
                        {isSubmitting ? '创建中...' : '创建实例'}
                      </button>
                    </div>
                  </div>
                  <div style={tabGuidePanelStyle}>
                    <h3 style={guideTitleStyle}>Token 配对说明</h3>
                    <p style={guideTextStyle}>适用于已直接拿到 endpoint 与 token 的场景，先测试连接再创建实例。</p>
                    <p style={guideTextStyle}>创建后可在左侧列表切换实例，并设置当前实例作为默认请求上下文。</p>
                  </div>
                </div>
              ) : createTab === 'pair_code' ? (
                <div style={resolvedTabBodyLayoutStyle}>
                  <div style={tabFormPanelStyle}>
                    <label style={fieldStyle}>
                      <span style={labelStyle}>实例名称</span>
                      <input
                        value={pairCodeName}
                        onChange={(event) => setPairCodeName(event.target.value)}
                        placeholder="例如 claw2"
                        style={inputStyle}
                        disabled={isSubmitting || isValidating}
                      />
                    </label>
                    <label style={fieldStyle}>
                      <span style={labelStyle}>配对码</span>
                      <textarea
                        value={pairCode}
                        onChange={(event) => setPairCode(event.target.value)}
                        placeholder="粘贴配对码，支持 LP1.*** 或 linpo://pair?code=***"
                        style={textareaStyle}
                        disabled={isSubmitting || isValidating}
                      />
                    </label>
                    {pairCodeValidationText ? <p style={hintTextStyle}>{pairCodeValidationText}</p> : null}
                    <div style={actionRowStyle}>
                      <button
                        type="button"
                        style={ghostButtonStyle}
                        onClick={() => void handleValidatePairCode()}
                        disabled={isSubmitting || isValidating}
                      >
                        {isValidating ? '校验中...' : '校验配对码'}
                      </button>
                      <button
                        type="button"
                        style={primaryButtonStyle}
                        onClick={() => void handleCreateByPairCode()}
                        disabled={isSubmitting || isValidating}
                      >
                        {isSubmitting ? '创建中...' : '创建实例'}
                      </button>
                    </div>
                  </div>
                  <div style={tabGuidePanelStyle}>
                    <h3 style={guideTitleStyle}>配对码说明</h3>
                    <p style={guideTextStyle}>适用于只拿到短码的场景；后端会解析配对码并复用实例校验/创建流程。</p>
                    <p style={guideTextStyle}>推荐通过 OpenClaw 对话请求“生成配对码”，然后粘贴到左侧表单。</p>
                  </div>
                </div>
              ) : createTab === 'openclaw_auto' ? (
                <div style={resolvedTabBodyLayoutStyle}>
                  <div style={tabFormPanelStyle}>
                    <label style={fieldStyle}>
                      <span style={labelStyle}>自动接入指令</span>
                      <textarea value={openClawAutoPrompt} readOnly style={textareaStyle} rows={8} />
                    </label>
                    <div style={actionRowStyle}>
                      <button type="button" style={ghostButtonStyle} onClick={() => void handleCopyOpenClawAutoPrompt()}>
                        复制指令
                      </button>
                      <a
                        href={tutorialLink}
                        target="_blank"
                        rel="noreferrer noopener"
                        style={linkButtonStyle}
                      >
                        打开教程页
                      </a>
                    </div>
                  </div>
                  <div style={tabGuidePanelStyle}>
                    <h3 style={guideTitleStyle}>OpenClaw 自动接入说明</h3>
                    <p style={guideTextStyle}>将左侧整段指令直接发送给 OpenClaw，让它自动执行教程中的接入流程。</p>
                    <p style={guideTextStyle}>OpenClaw 会按教程完成 request 并返回确认地址；你登录 Linpo 后点击确认即可完成挂载。</p>
                  </div>
                </div>
              ) : (
                <div style={resolvedTabBodyLayoutStyle}>
                  <div style={tabFormPanelStyle}>
                    <label style={fieldStyle}>
                      <span style={labelStyle}>教程链接</span>
                      <input value={tutorialLink} readOnly style={inputStyle} />
                    </label>
                    <div style={actionRowStyle}>
                      <button type="button" style={ghostButtonStyle} onClick={() => void handleCopyTutorialLink()}>
                        复制链接
                      </button>
                      <a
                        href={tutorialLink}
                        target="_blank"
                        rel="noreferrer noopener"
                        style={linkButtonStyle}
                      >
                        打开教程页
                      </a>
                    </div>
                  </div>
                  <div style={tabGuidePanelStyle}>
                    <h3 style={guideTitleStyle}>教程链接配对说明</h3>
                    <p style={guideTextStyle}>把该链接直接发送给 OpenClaw。</p>
                    <p style={guideTextStyle}>OpenClaw 按页面内 Markdown 发起 request，拿到 confirmation_url 后由用户登录 Linpo 点击确认。</p>
                  </div>
                </div>
              )}
            </article>
          ) : selectedInstance ? (
            <article style={cardStyle} aria-label="实例详情">
              <div style={detailHeaderStyle}>
                <h3 style={detailTitleStyle}>{selectedInstance.name}</h3>
                <span style={statusBadgeStyle}>状态 {selectedInstance.status}</span>
              </div>
              <div style={detailGridStyle}>
                <section style={detailBlockStyle}>
                  <p style={detailLabelStyle}>Endpoint</p>
                  <p style={detailValueStyle}>{selectedInstance.endpoint}</p>
                </section>
                <section style={detailBlockStyle}>
                  <p style={detailLabelStyle}>最近检查</p>
                  <p style={detailValueStyle}>{selectedInstance.last_check_at ?? '暂无'}</p>
                </section>
                <section style={detailBlockStyle}>
                  <p style={detailLabelStyle}>创建时间</p>
                  <p style={detailValueStyle}>{selectedInstance.created_at}</p>
                </section>
              </div>
              <section style={topologySectionStyle} aria-label="实例拓扑树">
                <div style={topologyHeaderStyle}>
                  <p style={detailLabelStyle}>关系拓扑</p>
                  <button
                    type="button"
                    style={ghostButtonStyle}
                    onClick={() => void reloadTopology()}
                    disabled={isTopologyLoading}
                  >
                    {isTopologyLoading ? '刷新中...' : '刷新拓扑'}
                  </button>
                </div>
                {isTopologyLoading ? <p style={hintTextStyle}>拓扑加载中...</p> : null}
                {!isTopologyLoading && topologyError ? (
                  <p style={topologyErrorStyle}>拓扑读取失败：{topologyError}</p>
                ) : null}
                {!isTopologyLoading && !topologyError && topologyDiagnostic?.status === 'failed' ? (
                  <p style={topologyErrorStyle}>实例不可用：{topologyDiagnostic.error?.message ?? '连接失败'}</p>
                ) : null}
                {!isTopologyLoading && !topologyError && topologyAgents.length === 0 ? (
                  <p style={hintTextStyle}>当前实例暂无 Agent 或 Session。</p>
                ) : null}
                {!isTopologyLoading && !topologyError && topologyAgents.length > 0 ? (
                  <div style={topologyTreeWrapStyle} data-testid="instance-topology-tree">
                    <ul style={treeRootListStyle}>
                      <li style={treeItemStyle}>
                        <div style={treeInstanceNodeStyle}>
                          <span>实例</span>
                          <strong style={treeNodeStrongStyle}>{selectedInstance.name}</strong>
                        </div>
                        <ul style={treeChildListStyle}>
                          {topologyAgents.map((agent) => (
                            <li key={agent.agentId} style={treeItemStyle}>
                              <div style={treeAgentNodeStyle}>
                                <span style={treeNodeMainLabelStyle}>
                                  Agent · {agent.agentName || agent.agentId}
                                </span>
                                <span style={treeNodeMetaStyle}>
                                  {agent.isActive ? '活跃' : agent.status} · {agent.sessions.length} 会话
                                </span>
                              </div>
                              {agent.sessions.length > 0 ? (
                                <ul style={treeChildListStyle}>
                                  {agent.sessions.map((session) => (
                                    <li key={session.sessionKey} style={treeItemStyle}>
                                      <div style={treeSessionNodeStyle}>
                                        <span style={treeNodeMainLabelStyle}>
                                          Session · {session.label || session.sessionKey}
                                        </span>
                                        <span style={treeNodeMetaStyle}>
                                          {session.updatedAt ? `更新于 ${session.updatedAt}` : '暂无更新时间'}
                                        </span>
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p style={treeEmptyHintStyle}>该 Agent 暂无 Session</p>
                              )}
                            </li>
                          ))}
                        </ul>
                      </li>
                    </ul>
                  </div>
                ) : null}
              </section>
              <div style={actionRowStyle}>
                {currentInstanceId === selectedInstance.id ? (
                  <span style={currentBadgeStyle}>当前实例</span>
                ) : (
                  <button
                    type="button"
                    style={primaryButtonStyle}
                    onClick={() => {
                      setCurrentInstanceId(selectedInstance.id);
                      addToast(`已切换当前实例：${selectedInstance.name}`, 'success');
                    }}
                  >
                    设为当前实例
                  </button>
                )}
                <button type="button" style={dangerButtonStyle} onClick={() => void handleDelete(selectedInstance)}>
                  删除实例
                </button>
              </div>
            </article>
          ) : (
            <article style={cardStyle} aria-label="实例详情空态">
              <p style={hintTextStyle}>当前实例不存在或已被删除，请从左侧重新选择。</p>
            </article>
          )}
        </section>
      </div>
    </section>
  );
}

function buildOpenClawAutoPrompt(tutorialLink: string): string {
  return [
    '请直接自动执行 OpenClaw 到 Linpo 的接入流程，不要只回复说明。',
    '严格按这个教程页面操作并推进到可确认状态：',
    tutorialLink,
    '',
    '执行要求：',
    '1) 按教程向 Linpo 发起 request，拿到 confirmation_url。',
    '2) 把 confirmation_url 原样返回给我，不要改写。',
    '3) 如果缺少参数或失败，直接给出下一步可执行命令与错误信息。',
  ].join('\n');
}

const pageStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.7rem',
};

const toolbarStyle: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 40,
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

const toolbarTitleBlockStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.15rem',
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.92rem',
  color: '#0f172a',
  fontWeight: 700,
};

const subtitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.74rem',
  color: '#475569',
};

const workspaceStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 0,
  display: 'grid',
  gridTemplateColumns: 'minmax(220px, 280px) minmax(0, 1fr)',
  gap: '0.75rem',
};

const workspaceStyleMobile: React.CSSProperties = {
  ...workspaceStyle,
  gridTemplateColumns: 'minmax(0, 1fr)',
  gap: '0.62rem',
};

const sidebarStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.28)',
  borderRadius: '0.65rem',
  background: 'rgba(255, 255, 255, 0.86)',
  boxShadow: '0 14px 30px -28px rgba(15, 23, 42, 0.9)',
  padding: '0.62rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.62rem',
  minHeight: '420px',
};

const newPairingButtonStyle: React.CSSProperties = {
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'rgba(14, 116, 144, 0.42)',
  background: 'rgba(240, 249, 255, 0.88)',
  color: '#075985',
  borderRadius: '0.48rem',
  padding: '0.45rem 0.55rem',
  fontSize: '0.78rem',
  fontWeight: 700,
  cursor: 'pointer',
  textAlign: 'left',
};

const newPairingButtonActiveStyle: React.CSSProperties = {
  background: 'linear-gradient(120deg, rgba(20, 184, 166, 0.22), rgba(14, 165, 233, 0.16))',
  borderColor: 'rgba(14, 116, 144, 0.58)',
};

const sidebarListWrapStyle: React.CSSProperties = {
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.45rem',
};

const sidebarSectionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.74rem',
  color: '#64748b',
  fontWeight: 700,
};

const sidebarListStyle: React.CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.36rem',
  overflowY: 'auto',
};

const instanceListItemButtonStyle: React.CSSProperties = {
  width: '100%',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'rgba(148, 163, 184, 0.28)',
  background: 'rgba(255, 255, 255, 0.76)',
  borderRadius: '0.46rem',
  padding: '0.4rem 0.48rem',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.4rem',
  textAlign: 'left',
};

const instanceListItemButtonActiveStyle: React.CSSProperties = {
  borderColor: 'rgba(14, 116, 144, 0.56)',
  background: 'rgba(224, 242, 254, 0.86)',
};

const instanceListItemNameStyle: React.CSSProperties = {
  fontSize: '0.76rem',
  fontWeight: 700,
  color: '#0f172a',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const instanceListItemMetaStyle: React.CSSProperties = {
  fontSize: '0.68rem',
  color: '#475569',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const mainStageStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 0,
};

const cardStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.3)',
  borderRadius: '0.75rem',
  background: 'rgba(255, 255, 255, 0.9)',
  boxShadow: '0 20px 38px -30px rgba(15, 23, 42, 0.8)',
  padding: '0.9rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.7rem',
  minHeight: '420px',
};

const tabsRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.45rem',
};

const tabButtonStyle: React.CSSProperties = {
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'rgba(148, 163, 184, 0.35)',
  background: 'rgba(255, 255, 255, 0.78)',
  color: '#334155',
  borderRadius: '0.42rem',
  padding: '0.3rem 0.72rem',
  fontSize: '0.76rem',
  fontWeight: 700,
  cursor: 'pointer',
};

const tabButtonActiveStyle: React.CSSProperties = {
  borderColor: 'rgba(14, 116, 144, 0.54)',
  background: 'rgba(224, 242, 254, 0.9)',
  color: '#075985',
};

const tabBodyLayoutStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(280px, 420px) minmax(220px, 1fr)',
  gap: '0.9rem',
  alignItems: 'start',
};

const tabBodyLayoutStyleMobile: React.CSSProperties = {
  ...tabBodyLayoutStyle,
  gridTemplateColumns: 'minmax(0, 1fr)',
  gap: '0.62rem',
};

const tabFormPanelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.55rem',
};

const tabGuidePanelStyle: React.CSSProperties = {
  border: '1px dashed rgba(148, 163, 184, 0.42)',
  borderRadius: '0.62rem',
  background: 'rgba(248, 250, 252, 0.82)',
  padding: '0.68rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.36rem',
};

const guideTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  color: '#0f172a',
  fontWeight: 700,
};

const guideTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.74rem',
  color: '#334155',
  lineHeight: 1.5,
};

const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.24rem',
};

const labelStyle: React.CSSProperties = {
  fontSize: '0.74rem',
  color: '#334155',
  fontWeight: 600,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid rgba(15, 23, 42, 0.18)',
  borderRadius: '0.42rem',
  padding: '0.38rem 0.46rem',
  fontSize: '0.8rem',
  background: 'rgba(255, 255, 255, 0.94)',
  color: '#0f172a',
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  minHeight: '120px',
  resize: 'vertical',
  lineHeight: 1.45,
};

const hintTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.75rem',
  color: '#475569',
  lineHeight: 1.45,
};

const actionRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.45rem',
  flexWrap: 'wrap',
};

const ghostButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.48)',
  background: 'rgba(255, 255, 255, 0.86)',
  color: '#0f172a',
  borderRadius: '0.45rem',
  padding: '0.38rem 0.72rem',
  fontSize: '0.78rem',
  fontWeight: 700,
  cursor: 'pointer',
};

const primaryButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(14, 116, 144, 0.5)',
  background: 'linear-gradient(120deg, #0f766e 0%, #0284c7 100%)',
  color: '#f8fafc',
  borderRadius: '0.45rem',
  padding: '0.38rem 0.72rem',
  fontSize: '0.78rem',
  fontWeight: 700,
  cursor: 'pointer',
};

const linkButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const dangerButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(220, 38, 38, 0.4)',
  background: 'rgba(254, 242, 242, 0.92)',
  color: '#991b1b',
  borderRadius: '0.45rem',
  padding: '0.38rem 0.72rem',
  fontSize: '0.78rem',
  fontWeight: 700,
  cursor: 'pointer',
};

const detailHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.65rem',
};

const detailTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.92rem',
  color: '#0f172a',
  fontWeight: 700,
};

const statusBadgeStyle: React.CSSProperties = {
  border: '1px solid rgba(14, 116, 144, 0.35)',
  background: 'rgba(224, 242, 254, 0.9)',
  color: '#075985',
  borderRadius: '999px',
  padding: '0.15rem 0.52rem',
  fontSize: '0.7rem',
  fontWeight: 700,
};

const detailGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: '0.6rem',
};

const detailBlockStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.25)',
  borderRadius: '0.58rem',
  background: 'rgba(255, 255, 255, 0.82)',
  padding: '0.56rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.2rem',
};

const detailLabelStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.7rem',
  color: '#64748b',
  fontWeight: 700,
};

const detailValueStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.78rem',
  color: '#0f172a',
  lineHeight: 1.45,
  wordBreak: 'break-word',
};

const currentBadgeStyle: React.CSSProperties = {
  border: '1px solid rgba(14, 116, 144, 0.4)',
  background: 'rgba(240, 249, 255, 0.88)',
  color: '#0369a1',
  borderRadius: '999px',
  padding: '0.15rem 0.52rem',
  fontSize: '0.72rem',
  fontWeight: 700,
};

const topologySectionStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.25)',
  borderRadius: '0.58rem',
  background: 'rgba(255, 255, 255, 0.84)',
  padding: '0.56rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.45rem',
  minHeight: '180px',
};

const topologyHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.5rem',
};

const topologyErrorStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.74rem',
  color: '#b91c1c',
  lineHeight: 1.45,
};

const topologyTreeWrapStyle: React.CSSProperties = {
  maxHeight: '320px',
  overflowY: 'auto',
  paddingRight: '0.12rem',
};

const treeRootListStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: 'none',
};

const treeChildListStyle: React.CSSProperties = {
  margin: '0.36rem 0 0 0.68rem',
  padding: 0,
  listStyle: 'none',
  borderLeft: '1px dashed rgba(148, 163, 184, 0.45)',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.28rem',
};

const treeItemStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
};

const treeInstanceNodeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.42rem',
  border: '1px solid rgba(14, 116, 144, 0.32)',
  background: 'rgba(224, 242, 254, 0.75)',
  borderRadius: '0.45rem',
  padding: '0.3rem 0.48rem',
  fontSize: '0.76rem',
  color: '#0f172a',
};

const treeAgentNodeStyle: React.CSSProperties = {
  marginLeft: '0.56rem',
  border: '1px solid rgba(148, 163, 184, 0.32)',
  background: 'rgba(248, 250, 252, 0.9)',
  borderRadius: '0.45rem',
  padding: '0.28rem 0.44rem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.48rem',
};

const treeSessionNodeStyle: React.CSSProperties = {
  marginLeft: '0.56rem',
  border: '1px solid rgba(148, 163, 184, 0.22)',
  background: 'rgba(255, 255, 255, 0.92)',
  borderRadius: '0.42rem',
  padding: '0.22rem 0.4rem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.48rem',
};

const treeNodeStrongStyle: React.CSSProperties = {
  fontSize: '0.76rem',
  color: '#0f172a',
};

const treeNodeMainLabelStyle: React.CSSProperties = {
  fontSize: '0.74rem',
  color: '#0f172a',
  fontWeight: 700,
  lineHeight: 1.35,
  wordBreak: 'break-word',
};

const treeNodeMetaStyle: React.CSSProperties = {
  fontSize: '0.68rem',
  color: '#64748b',
  whiteSpace: 'nowrap',
};

const treeEmptyHintStyle: React.CSSProperties = {
  margin: '0.2rem 0 0 1.22rem',
  fontSize: '0.7rem',
  color: '#64748b',
};
