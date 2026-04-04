import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAggregateTopology } from '../api/client';
import { updatePassword, updateProfile } from '../api/authClient';
import {
  createInstance,
  createInstanceByPairCode,
  listInstances,
  validateInstance,
  validateInstanceByPairCode,
} from '../api/instanceClient';
import type { AggregateTopologyResponse, InstanceItem } from '../api/types';
import { useAuth } from '../hooks/useAuth';
import { useCurrentInstanceId } from '../hooks/useCurrentInstance';
import { useIsMobile } from '../hooks/useIsMobile';
import { useToast } from '../hooks/useToast';

type ViewMode = 'profile' | 'instances';
type ModalType = 'none' | 'password' | 'avatar' | 'upgrade' | 'mount';
type MountTab = 'token' | 'pair_code' | 'openclaw_auto' | 'tutorial_link';

interface TopologySessionItem {
  sessionKey: string;
  label: string;
  updatedAt: string | null;
}

interface TopologyAgentItem {
  agentId: string;
  agentName: string;
  status: string;
  isActive: boolean;
  sessions: TopologySessionItem[];
}

const DEFAULT_INSTANCE_NAME = 'claw2';
const DEFAULT_ENDPOINT = 'http://127.0.0.1:28789';

export function ProfilePage(): JSX.Element {
  const isMobile = useIsMobile(960);
  const { user, refresh } = useAuth();
  const [currentInstanceId] = useCurrentInstanceId();
  const { addToast } = useToast();

  const [viewMode, setViewMode] = useState<ViewMode>('profile');
  const [activeModal, setActiveModal] = useState<ModalType>('none');

  const [avatarDraft, setAvatarDraft] = useState<string | null>(null);
  const [isSavingAvatar, setIsSavingAvatar] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [instances, setInstances] = useState<InstanceItem[]>([]);
  const [isLoadingInstances, setIsLoadingInstances] = useState(false);
  const [isLoadingTopology, setIsLoadingTopology] = useState(false);
  const [topology, setTopology] = useState<AggregateTopologyResponse | null>(null);
  const [topologyError, setTopologyError] = useState<string | null>(null);
  const [expandedInstances, setExpandedInstances] = useState<Record<string, boolean>>({});

  const [mountTab, setMountTab] = useState<MountTab>('token');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isValidating, setIsValidating] = useState(false);

  const [tokenName, setTokenName] = useState(DEFAULT_INSTANCE_NAME);
  const [tokenEndpoint, setTokenEndpoint] = useState(DEFAULT_ENDPOINT);
  const [tokenGatewayToken, setTokenGatewayToken] = useState('');
  const [tokenValidationText, setTokenValidationText] = useState('');

  const [pairCodeName, setPairCodeName] = useState(DEFAULT_INSTANCE_NAME);
  const [pairCode, setPairCode] = useState('');
  const [pairCodeValidationText, setPairCodeValidationText] = useState('');

  useEffect(() => {
    setAvatarDraft(user?.avatar_url ?? null);
  }, [user?.avatar_url]);

  const avatarText = useMemo(() => getAvatarText(user?.username), [user?.username]);
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

  const topologyByInstance = useMemo(() => {
    if (!topology) {
      return new Map<string, TopologyAgentItem[]>();
    }

    const sessionsMap = new Map<string, TopologySessionItem[]>();
    for (const session of topology.sessions) {
      const list = sessionsMap.get(session.agent_id) ?? [];
      list.push({
        sessionKey: session.session_key,
        label: session.label,
        updatedAt: session.updated_at,
      });
      sessionsMap.set(session.agent_id, list);
    }

    const result = new Map<string, TopologyAgentItem[]>();
    for (const agent of topology.agents) {
      const list = result.get(agent.instance_id) ?? [];
      list.push({
        agentId: agent.agent_id,
        agentName: agent.agent_name,
        status: agent.status,
        isActive: agent.is_active,
        sessions: [...(sessionsMap.get(agent.agent_id) ?? [])].sort((a, b) =>
          a.sessionKey.localeCompare(b.sessionKey)
        ),
      });
      result.set(agent.instance_id, list);
    }

    for (const [instanceId, agents] of result.entries()) {
      result.set(
        instanceId,
        [...agents].sort((a, b) => a.agentName.localeCompare(b.agentName))
      );
    }

    return result;
  }, [topology]);

  const diagnosisByInstance = useMemo(() => {
    const map = new Map<string, string>();
    if (!topology) {
      return map;
    }
    for (const item of topology.diagnostics) {
      if (item.status === 'failed') {
        map.set(item.instance_id, item.error?.message ?? '连接失败');
      }
    }
    return map;
  }, [topology]);

  const loadInstances = useCallback(async () => {
    setIsLoadingInstances(true);
    try {
      const list = await listInstances();
      setInstances(list);
      setExpandedInstances((prev) => {
        const next: Record<string, boolean> = {};
        for (const item of list) {
          if (prev[item.id]) {
            next[item.id] = true;
          }
        }
        const normalizedCurrentId = (currentInstanceId ?? '').trim();
        const current = normalizedCurrentId
          ? list.find((item) => item.id === normalizedCurrentId)
          : null;
        if (current) {
          next[current.id] = true;
        } else if (list.length > 0 && Object.keys(next).length === 0) {
          next[list[0].id] = true;
        }
        return next;
      });
    } catch (error) {
      addToast(error instanceof Error ? error.message : '读取实例列表失败', 'error');
    } finally {
      setIsLoadingInstances(false);
    }
  }, [addToast, currentInstanceId]);

  const loadTopology = useCallback(async () => {
    setIsLoadingTopology(true);
    setTopologyError(null);
    try {
      const data = await getAggregateTopology();
      setTopology(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取拓扑失败';
      setTopologyError(message);
      setTopology(null);
    } finally {
      setIsLoadingTopology(false);
    }
  }, []);

  useEffect(() => {
    if (viewMode !== 'instances') {
      return;
    }
    void loadInstances();
    void loadTopology();
  }, [loadInstances, loadTopology, viewMode]);

  const closeModal = useCallback(() => {
    if (isSavingAvatar || isSavingPassword || isSubmitting || isValidating) {
      return;
    }
    setActiveModal('none');
  }, [isSavingAvatar, isSavingPassword, isSubmitting, isValidating]);

  const handleAvatarFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.currentTarget.value = '';
      if (!file) {
        return;
      }
      if (!file.type.startsWith('image/')) {
        addToast('请选择图片文件', 'warning');
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        addToast('头像大小需小于 2MB', 'warning');
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : null;
        if (!result) {
          addToast('头像读取失败，请重试', 'error');
          return;
        }
        setAvatarDraft(result);
      };
      reader.onerror = () => {
        addToast('头像读取失败，请重试', 'error');
      };
      reader.readAsDataURL(file);
    },
    [addToast]
  );

  const handleSaveAvatar = useCallback(async () => {
    if (isSavingAvatar) {
      return;
    }
    setIsSavingAvatar(true);
    try {
      await updateProfile({ avatar_url: avatarDraft ?? null });
      await refresh();
      addToast('头像已更新', 'success');
      setActiveModal('none');
    } catch (error) {
      const message = error instanceof Error ? error.message : '头像更新失败';
      addToast(message, 'error');
    } finally {
      setIsSavingAvatar(false);
    }
  }, [addToast, avatarDraft, isSavingAvatar, refresh]);

  const handleSubmitPassword = useCallback(async () => {
    if (isSavingPassword) {
      return;
    }
    if (!currentPassword || !newPassword || !confirmPassword) {
      addToast('请填写完整密码信息', 'warning');
      return;
    }
    if (newPassword !== confirmPassword) {
      addToast('两次输入的新密码不一致', 'warning');
      return;
    }
    if (newPassword.length < 6) {
      addToast('新密码长度至少 6 位', 'warning');
      return;
    }

    setIsSavingPassword(true);
    try {
      await updatePassword({
        current_password: currentPassword,
        new_password: newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      addToast('密码已更新', 'success');
      setActiveModal('none');
    } catch (error) {
      const message = error instanceof Error ? error.message : '密码更新失败';
      addToast(message, 'error');
    } finally {
      setIsSavingPassword(false);
    }
  }, [addToast, confirmPassword, currentPassword, isSavingPassword, newPassword]);

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
      addToast(`创建成功：${created.name}`, 'success');
      await loadInstances();
      await loadTopology();
      setActiveModal('none');
    } catch (error) {
      addToast(error instanceof Error ? error.message : '创建实例失败', 'error');
    } finally {
      setIsSubmitting(false);
    }
  }, [addToast, loadInstances, loadTopology, tokenEndpoint, tokenGatewayToken, tokenName]);

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
      addToast(`创建成功：${created.name}`, 'success');
      await loadInstances();
      await loadTopology();
      setActiveModal('none');
    } catch (error) {
      addToast(error instanceof Error ? error.message : '配对码创建失败', 'error');
    } finally {
      setIsSubmitting(false);
    }
  }, [addToast, loadInstances, loadTopology, pairCode, pairCodeName]);

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

  const toggleExpanded = useCallback((instanceId: string) => {
    setExpandedInstances((prev) => ({
      ...prev,
      [instanceId]: !prev[instanceId],
    }));
  }, []);

  return (
    <section style={pageStyle} aria-label="profile-page">
      <div style={isMobile ? layoutMobileStyle : layoutStyle}>
        <aside style={{ ...sidebarStyle, ...(isMobile ? sidebarMobileStyle : null) }} aria-label="资料页导航">
          <button
            type="button"
            style={{
              ...sideButtonStyle,
              ...(viewMode === 'profile' ? sideButtonActiveStyle : null),
            }}
            onClick={() => setViewMode('profile')}
          >
            用户信息
          </button>
          <button
            type="button"
            style={{
              ...sideButtonStyle,
              ...(viewMode === 'instances' ? sideButtonActiveStyle : null),
            }}
            onClick={() => setViewMode('instances')}
          >
            实例列表
          </button>
        </aside>

        <main style={mainStyle}>
          {viewMode === 'profile' ? (
            <article style={cardStyle}>
              <header style={cardHeaderStyle}>
                <h1 style={cardTitleStyle}>用户信息</h1>
                <p style={cardHintStyle}>管理头像、登录密码与会员状态</p>
              </header>

              <div style={profileTopStyle}>
                <div style={avatarShellStyle}>
                  {avatarDraft ? (
                    <img src={avatarDraft} alt="用户头像" style={avatarImageStyle} />
                  ) : (
                    <span style={avatarFallbackStyle}>{avatarText}</span>
                  )}
                </div>
                <div style={profileMetaStyle}>
                  <p style={metaNameStyle}>{user?.username ?? '--'}</p>
                  <p style={metaEmailStyle}>{user?.email ?? '--'}</p>
                </div>
              </div>

              <div style={buttonRowStyle}>
                <button type="button" style={actionButtonStyle} onClick={() => setActiveModal('password')}>
                  修改密码
                </button>
                <button type="button" style={actionButtonStyle} onClick={() => setActiveModal('avatar')}>
                  更换头像
                </button>
                <button type="button" style={upgradeButtonStyle} onClick={() => setActiveModal('upgrade')}>
                  升级会员
                </button>
              </div>
            </article>
          ) : (
            <article style={cardStyle}>
              <header style={instancesHeaderStyle}>
                <div>
                  <h2 style={cardTitleStyle}>已配对实例</h2>
                  <p style={cardHintStyle}>可展开查看实例基础信息与拓扑结构</p>
                </div>
                <div style={buttonRowStyle}>
                  <button type="button" style={actionButtonStyle} onClick={() => setActiveModal('mount')}>
                    挂载实例
                  </button>
                  <button
                    type="button"
                    style={secondaryButtonStyle}
                    onClick={() => {
                      void loadInstances();
                      void loadTopology();
                    }}
                    disabled={isLoadingInstances || isLoadingTopology}
                  >
                    {isLoadingInstances || isLoadingTopology ? '刷新中...' : '刷新'}
                  </button>
                </div>
              </header>

              {isLoadingInstances ? <p style={hintTextStyle}>实例加载中...</p> : null}
              {!isLoadingInstances && sortedInstances.length === 0 ? (
                <p style={hintTextStyle}>暂无已配对实例，点击右上角“挂载实例”开始接入。</p>
              ) : null}
              {topologyError ? <p style={errorTextStyle}>拓扑读取失败：{topologyError}</p> : null}

              {!isLoadingInstances && sortedInstances.length > 0 ? (
                <ul style={instanceListStyle}>
                  {sortedInstances.map((item) => {
                    const expanded = Boolean(expandedInstances[item.id]);
                    const agents = topologyByInstance.get(item.id) ?? [];
                    const diagnosis = diagnosisByInstance.get(item.id);
                    return (
                      <li key={item.id} style={instanceCardStyle}>
                        <button
                          type="button"
                          style={instanceHeadButtonStyle}
                          onClick={() => toggleExpanded(item.id)}
                        >
                          <span style={instanceNameStyle}>{item.name}</span>
                          <span style={instanceMetaStyle}>{expanded ? '收起' : '展开'}</span>
                        </button>
                        {expanded ? (
                          <div style={instanceContentStyle}>
                            <div style={instanceGridStyle}>
                              <p style={infoLineStyle}>
                                <strong>状态：</strong>
                                {item.status}
                              </p>
                              <p style={infoLineStyle}>
                                <strong>Endpoint：</strong>
                                {item.endpoint}
                              </p>
                              <p style={infoLineStyle}>
                                <strong>创建时间：</strong>
                                {item.created_at}
                              </p>
                              <p style={infoLineStyle}>
                                <strong>最近检查：</strong>
                                {item.last_check_at ?? '暂无'}
                              </p>
                            </div>

                            <div style={treeWrapStyle}>
                              <p style={treeTitleStyle}>树状拓扑</p>
                              {isLoadingTopology ? <p style={hintTextStyle}>拓扑加载中...</p> : null}
                              {!isLoadingTopology && diagnosis ? (
                                <p style={errorTextStyle}>实例不可用：{diagnosis}</p>
                              ) : null}
                              {!isLoadingTopology && !diagnosis && agents.length === 0 ? (
                                <p style={hintTextStyle}>当前实例暂无 Agent 或 Session。</p>
                              ) : null}
                              {!isLoadingTopology && !diagnosis && agents.length > 0 ? (
                                <ul style={treeRootListStyle}>
                                  <li style={treeItemStyle}>
                                    <div style={treeInstanceNodeStyle}>
                                      <span>实例</span>
                                      <strong>{item.name}</strong>
                                    </div>
                                    <ul style={treeChildListStyle}>
                                      {agents.map((agent) => (
                                        <li key={agent.agentId} style={treeItemStyle}>
                                          <div style={treeAgentNodeStyle}>
                                            <span>Agent · {agent.agentName || agent.agentId}</span>
                                            <span style={treeNodeMetaStyle}>
                                              {agent.isActive ? '活跃' : agent.status} · {agent.sessions.length} 会话
                                            </span>
                                          </div>
                                          {agent.sessions.length > 0 ? (
                                            <ul style={treeChildListStyle}>
                                              {agent.sessions.map((session) => (
                                                <li key={session.sessionKey} style={treeItemStyle}>
                                                  <div style={treeSessionNodeStyle}>
                                                    <span>
                                                      Session · {session.label || session.sessionKey}
                                                    </span>
                                                    <span style={treeNodeMetaStyle}>
                                                      {session.updatedAt
                                                        ? `更新于 ${session.updatedAt}`
                                                        : '暂无更新时间'}
                                                    </span>
                                                  </div>
                                                </li>
                                              ))}
                                            </ul>
                                          ) : (
                                            <p style={hintTextStyle}>该 Agent 暂无 Session</p>
                                          )}
                                        </li>
                                      ))}
                                    </ul>
                                  </li>
                                </ul>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </article>
          )}
        </main>
      </div>

      {activeModal !== 'none' ? (
        <div style={modalOverlayStyle} role="dialog" aria-modal="true" aria-label={getModalTitle(activeModal)}>
          <div style={modalCardStyle}>
            <div style={modalHeaderStyle}>
              <h3 style={modalTitleStyle}>{getModalTitle(activeModal)}</h3>
              <button type="button" style={closeButtonStyle} onClick={closeModal}>
                关闭
              </button>
            </div>

            {activeModal === 'password' ? (
              <div style={modalBodyStyle}>
                <label style={inputLabelStyle}>
                  当前密码
                  <input
                    type="password"
                    style={inputStyle}
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    autoComplete="current-password"
                    disabled={isSavingPassword}
                  />
                </label>
                <label style={inputLabelStyle}>
                  新密码
                  <input
                    type="password"
                    style={inputStyle}
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    autoComplete="new-password"
                    disabled={isSavingPassword}
                  />
                </label>
                <label style={inputLabelStyle}>
                  确认新密码
                  <input
                    type="password"
                    style={inputStyle}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                    disabled={isSavingPassword}
                  />
                </label>
                <div style={buttonRowStyle}>
                  <button
                    type="button"
                    style={actionButtonStyle}
                    onClick={() => void handleSubmitPassword()}
                    disabled={isSavingPassword}
                  >
                    {isSavingPassword ? '更新中...' : '更新密码'}
                  </button>
                </div>
              </div>
            ) : null}

            {activeModal === 'avatar' ? (
              <div style={modalBodyStyle}>
                <div style={avatarPreviewStyle}>
                  {avatarDraft ? (
                    <img src={avatarDraft} alt="头像预览" style={avatarImageStyle} />
                  ) : (
                    <span style={avatarFallbackStyle}>{avatarText}</span>
                  )}
                </div>
                <label htmlFor="profile-avatar-upload" style={uploadButtonStyle}>
                  选择图片（小于 2MB）
                </label>
                <input
                  id="profile-avatar-upload"
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarFileChange}
                  style={hiddenInputStyle}
                  disabled={isSavingAvatar}
                />
                <div style={buttonRowStyle}>
                  <button
                    type="button"
                    style={actionButtonStyle}
                    onClick={() => void handleSaveAvatar()}
                    disabled={isSavingAvatar}
                  >
                    {isSavingAvatar ? '保存中...' : '保存头像'}
                  </button>
                </div>
              </div>
            ) : null}

            {activeModal === 'upgrade' ? (
              <div style={modalBodyStyle}>
                <p style={hintTextStyle}>支付通道建设中，暂未开通。</p>
                <div style={rechargeGridStyle}>
                  <div style={rechargeItemStyle}>
                    <span style={rechargeNameStyle}>支付宝</span>
                    <span style={rechargeStatusStyle}>未开通</span>
                  </div>
                  <div style={rechargeItemStyle}>
                    <span style={rechargeNameStyle}>PayPal</span>
                    <span style={rechargeStatusStyle}>未开通</span>
                  </div>
                </div>
              </div>
            ) : null}

            {activeModal === 'mount' ? (
              <div style={modalBodyStyle}>
                <div style={tabsRowStyle} role="tablist" aria-label="挂载方式">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mountTab === 'token'}
                    style={{ ...tabButtonStyle, ...(mountTab === 'token' ? tabButtonActiveStyle : null) }}
                    onClick={() => setMountTab('token')}
                    disabled={isSubmitting || isValidating}
                  >
                    Token 配对
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mountTab === 'pair_code'}
                    style={{ ...tabButtonStyle, ...(mountTab === 'pair_code' ? tabButtonActiveStyle : null) }}
                    onClick={() => setMountTab('pair_code')}
                    disabled={isSubmitting || isValidating}
                  >
                    配对码配对
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mountTab === 'openclaw_auto'}
                    style={{ ...tabButtonStyle, ...(mountTab === 'openclaw_auto' ? tabButtonActiveStyle : null) }}
                    onClick={() => setMountTab('openclaw_auto')}
                    disabled={isSubmitting || isValidating}
                  >
                    OpenClaw 自动接入
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mountTab === 'tutorial_link'}
                    style={{ ...tabButtonStyle, ...(mountTab === 'tutorial_link' ? tabButtonActiveStyle : null) }}
                    onClick={() => setMountTab('tutorial_link')}
                    disabled={isSubmitting || isValidating}
                  >
                    教程链接配对
                  </button>
                </div>

                {mountTab === 'token' ? (
                  <div style={pairingLayoutStyle}>
                    <div style={tabFormPanelStyle}>
                      <label style={inputLabelStyle}>
                        实例名称
                        <input
                          value={tokenName}
                          onChange={(event) => setTokenName(event.target.value)}
                          placeholder="例如 claw2"
                          style={inputStyle}
                          disabled={isSubmitting || isValidating}
                        />
                      </label>
                      <label style={inputLabelStyle}>
                        OpenClaw Endpoint
                        <input
                          value={tokenEndpoint}
                          onChange={(event) => setTokenEndpoint(event.target.value)}
                          placeholder="http://127.0.0.1:28789"
                          style={inputStyle}
                          disabled={isSubmitting || isValidating}
                        />
                      </label>
                      <label style={inputLabelStyle}>
                        Gateway Token
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
                      <div style={buttonRowStyle}>
                        <button
                          type="button"
                          style={secondaryButtonStyle}
                          onClick={() => void handleValidateToken()}
                          disabled={isSubmitting || isValidating}
                        >
                          {isValidating ? '测试中...' : '测试连接'}
                        </button>
                        <button
                          type="button"
                          style={actionButtonStyle}
                          onClick={() => void handleCreateByToken()}
                          disabled={isSubmitting || isValidating}
                        >
                          {isSubmitting ? '创建中...' : '创建实例'}
                        </button>
                      </div>
                    </div>
                    <div style={guidePanelStyle}>
                      <h4 style={guideTitleStyle}>Token 配对说明</h4>
                      <p style={guideTextStyle}>适用于已直接拿到 endpoint 与 token 的场景，先测试连接再创建实例。</p>
                      <p style={guideTextStyle}>创建后可在实例列表展开查看拓扑树。</p>
                    </div>
                  </div>
                ) : null}

                {mountTab === 'pair_code' ? (
                  <div style={pairingLayoutStyle}>
                    <div style={tabFormPanelStyle}>
                      <label style={inputLabelStyle}>
                        实例名称
                        <input
                          value={pairCodeName}
                          onChange={(event) => setPairCodeName(event.target.value)}
                          placeholder="例如 claw2"
                          style={inputStyle}
                          disabled={isSubmitting || isValidating}
                        />
                      </label>
                      <label style={inputLabelStyle}>
                        配对码
                        <textarea
                          value={pairCode}
                          onChange={(event) => setPairCode(event.target.value)}
                          placeholder="粘贴配对码，支持 LP1.*** 或 linpo://pair?code=***"
                          style={textareaStyle}
                          disabled={isSubmitting || isValidating}
                        />
                      </label>
                      {pairCodeValidationText ? <p style={hintTextStyle}>{pairCodeValidationText}</p> : null}
                      <div style={buttonRowStyle}>
                        <button
                          type="button"
                          style={secondaryButtonStyle}
                          onClick={() => void handleValidatePairCode()}
                          disabled={isSubmitting || isValidating}
                        >
                          {isValidating ? '校验中...' : '校验配对码'}
                        </button>
                        <button
                          type="button"
                          style={actionButtonStyle}
                          onClick={() => void handleCreateByPairCode()}
                          disabled={isSubmitting || isValidating}
                        >
                          {isSubmitting ? '创建中...' : '创建实例'}
                        </button>
                      </div>
                    </div>
                    <div style={guidePanelStyle}>
                      <h4 style={guideTitleStyle}>配对码说明</h4>
                      <p style={guideTextStyle}>适用于只拿到短码的场景；后端会解析配对码并复用实例校验/创建流程。</p>
                      <p style={guideTextStyle}>推荐通过 OpenClaw 对话请求“生成配对码”，然后粘贴到这里。</p>
                    </div>
                  </div>
                ) : null}

                {mountTab === 'openclaw_auto' ? (
                  <div style={pairingLayoutStyle}>
                    <div style={tabFormPanelStyle}>
                      <label style={inputLabelStyle}>
                        自动接入指令
                        <textarea value={openClawAutoPrompt} readOnly style={textareaStyle} rows={8} />
                      </label>
                      <div style={buttonRowStyle}>
                        <button
                          type="button"
                          style={secondaryButtonStyle}
                          onClick={() => void handleCopyOpenClawAutoPrompt()}
                        >
                          复制指令
                        </button>
                        <a href={tutorialLink} target="_blank" rel="noreferrer noopener" style={linkButtonStyle}>
                          打开教程页
                        </a>
                      </div>
                    </div>
                    <div style={guidePanelStyle}>
                      <h4 style={guideTitleStyle}>OpenClaw 自动接入说明</h4>
                      <p style={guideTextStyle}>将左侧整段指令直接发送给 OpenClaw，让它自动执行教程中的接入流程。</p>
                      <p style={guideTextStyle}>OpenClaw 会返回 confirmation_url；你登录 Linpo 后点击确认即可完成挂载。</p>
                    </div>
                  </div>
                ) : null}

                {mountTab === 'tutorial_link' ? (
                  <div style={pairingLayoutStyle}>
                    <div style={tabFormPanelStyle}>
                      <label style={inputLabelStyle}>
                        教程链接
                        <input value={tutorialLink} readOnly style={inputStyle} />
                      </label>
                      <div style={buttonRowStyle}>
                        <button
                          type="button"
                          style={secondaryButtonStyle}
                          onClick={() => void handleCopyTutorialLink()}
                        >
                          复制链接
                        </button>
                        <a href={tutorialLink} target="_blank" rel="noreferrer noopener" style={linkButtonStyle}>
                          打开教程页
                        </a>
                      </div>
                    </div>
                    <div style={guidePanelStyle}>
                      <h4 style={guideTitleStyle}>教程链接配对说明</h4>
                      <p style={guideTextStyle}>把该链接直接发送给 OpenClaw。</p>
                      <p style={guideTextStyle}>OpenClaw 按页面内 Markdown 发起 request，用户登录 Linpo 后点击确认。</p>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function getAvatarText(username: string | null | undefined): string {
  const normalized = username?.trim() ?? '';
  if (!normalized) {
    return 'U';
  }
  if (/^[\u3400-\u9fff]/.test(normalized)) {
    return normalized.charAt(0);
  }
  return normalized.slice(0, 2).toUpperCase();
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

function getModalTitle(modal: ModalType): string {
  if (modal === 'password') {
    return '修改密码';
  }
  if (modal === 'avatar') {
    return '更换头像';
  }
  if (modal === 'upgrade') {
    return '升级会员';
  }
  if (modal === 'mount') {
    return '挂载实例';
  }
  return '';
}

const pageStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 0,
};

const layoutStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '220px minmax(0, 1fr)',
  gap: '0.8rem',
  alignItems: 'start',
};

const layoutMobileStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.72rem',
};

const sidebarStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.3)',
  borderRadius: '0.8rem',
  padding: '0.65rem',
  background: 'rgba(255, 255, 255, 0.84)',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.45rem',
};

const sidebarMobileStyle: React.CSSProperties = {
  flexDirection: 'row',
};

const sideButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.4)',
  borderRadius: '0.56rem',
  background: 'rgba(248, 250, 252, 0.95)',
  color: '#1f2937',
  fontSize: '0.82rem',
  fontWeight: 600,
  textAlign: 'left',
  padding: '0.52rem 0.62rem',
  cursor: 'pointer',
};

const sideButtonActiveStyle: React.CSSProperties = {
  borderColor: 'rgba(14, 116, 144, 0.55)',
  background: 'linear-gradient(120deg, rgba(20, 184, 166, 0.2), rgba(14, 165, 233, 0.16))',
  color: '#0f172a',
};

const mainStyle: React.CSSProperties = {
  minWidth: 0,
};

const cardStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.3)',
  borderRadius: '0.9rem',
  padding: '0.9rem',
  background: 'rgba(255, 255, 255, 0.74)',
  backdropFilter: 'blur(8px)',
};

const cardHeaderStyle: React.CSSProperties = {
  marginBottom: '0.8rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.2rem',
};

const cardTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '1rem',
  fontWeight: 700,
  color: '#0f172a',
};

const cardHintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.78rem',
  color: '#52616f',
};

const profileTopStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.8rem',
  flexWrap: 'wrap',
  marginBottom: '0.8rem',
};

const avatarShellStyle: React.CSSProperties = {
  width: '4.2rem',
  height: '4.2rem',
  borderRadius: '999px',
  background: 'linear-gradient(145deg, rgba(16, 185, 129, 0.25), rgba(14, 165, 233, 0.25))',
  border: '1px solid rgba(56, 189, 248, 0.26)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
};

const avatarPreviewStyle: React.CSSProperties = {
  ...avatarShellStyle,
  width: '5rem',
  height: '5rem',
};

const avatarImageStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

const avatarFallbackStyle: React.CSSProperties = {
  fontSize: '1.2rem',
  fontWeight: 700,
  color: '#0f172a',
};

const profileMetaStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
};

const metaNameStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.92rem',
  fontWeight: 700,
  color: '#0f172a',
};

const metaEmailStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.82rem',
  color: '#475569',
  wordBreak: 'break-all',
};

const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.5rem',
  alignItems: 'center',
};

const actionButtonStyle: React.CSSProperties = {
  padding: '0.5rem 0.78rem',
  borderRadius: '0.5rem',
  border: 'none',
  background: 'linear-gradient(135deg, #0ea5e9, #14b8a6)',
  color: '#fff',
  fontSize: '0.78rem',
  fontWeight: 700,
  cursor: 'pointer',
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: '0.5rem 0.78rem',
  borderRadius: '0.5rem',
  border: '1px solid rgba(148, 163, 184, 0.45)',
  background: 'rgba(255, 255, 255, 0.86)',
  color: '#0f172a',
  fontSize: '0.78rem',
  fontWeight: 600,
  cursor: 'pointer',
};

const upgradeButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  borderColor: 'rgba(250, 204, 21, 0.48)',
  background: 'rgba(254, 249, 195, 0.86)',
  color: '#92400e',
};

const instancesHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '0.6rem',
  marginBottom: '0.8rem',
};

const instanceListStyle: React.CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.62rem',
};

const instanceCardStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.28)',
  borderRadius: '0.72rem',
  background: 'rgba(248, 250, 252, 0.92)',
  overflow: 'hidden',
};

const instanceHeadButtonStyle: React.CSSProperties = {
  width: '100%',
  border: 'none',
  borderBottom: '1px solid rgba(148, 163, 184, 0.24)',
  background: 'rgba(255, 255, 255, 0.88)',
  padding: '0.62rem 0.72rem',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '0.6rem',
  cursor: 'pointer',
  textAlign: 'left',
};

const instanceNameStyle: React.CSSProperties = {
  fontSize: '0.86rem',
  fontWeight: 700,
  color: '#0f172a',
};

const instanceMetaStyle: React.CSSProperties = {
  fontSize: '0.74rem',
  color: '#475569',
};

const instanceContentStyle: React.CSSProperties = {
  padding: '0.66rem 0.72rem 0.74rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.72rem',
};

const instanceGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: '0.42rem 0.75rem',
};

const infoLineStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.78rem',
  color: '#334155',
  wordBreak: 'break-all',
};

const treeWrapStyle: React.CSSProperties = {
  border: '1px dashed rgba(148, 163, 184, 0.45)',
  borderRadius: '0.62rem',
  padding: '0.62rem',
  background: 'rgba(255, 255, 255, 0.92)',
};

const treeTitleStyle: React.CSSProperties = {
  margin: '0 0 0.52rem',
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
  marginBottom: '0.38rem',
};

const treeInstanceNodeStyle: React.CSSProperties = {
  display: 'inline-flex',
  gap: '0.4rem',
  alignItems: 'center',
  borderRadius: '0.45rem',
  border: '1px solid rgba(14, 116, 144, 0.28)',
  background: 'rgba(224, 242, 254, 0.72)',
  padding: '0.32rem 0.45rem',
  fontSize: '0.76rem',
  color: '#0c4a6e',
};

const treeAgentNodeStyle: React.CSSProperties = {
  display: 'inline-flex',
  flexWrap: 'wrap',
  gap: '0.35rem',
  alignItems: 'center',
  borderRadius: '0.45rem',
  border: '1px solid rgba(56, 189, 248, 0.28)',
  background: 'rgba(240, 249, 255, 0.88)',
  padding: '0.28rem 0.45rem',
  fontSize: '0.74rem',
  color: '#075985',
};

const treeSessionNodeStyle: React.CSSProperties = {
  display: 'inline-flex',
  flexWrap: 'wrap',
  gap: '0.35rem',
  alignItems: 'center',
  borderRadius: '0.45rem',
  border: '1px solid rgba(148, 163, 184, 0.33)',
  background: 'rgba(248, 250, 252, 0.88)',
  padding: '0.24rem 0.42rem',
  fontSize: '0.73rem',
  color: '#1e293b',
};

const treeNodeMetaStyle: React.CSSProperties = {
  fontSize: '0.7rem',
  color: '#64748b',
};

const hintTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.76rem',
  color: '#64748b',
};

const errorTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.76rem',
  color: '#b91c1c',
};

const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '1rem',
  zIndex: 120,
};

const modalCardStyle: React.CSSProperties = {
  width: 'min(760px, 100%)',
  maxHeight: 'min(88vh, 920px)',
  overflowY: 'auto',
  borderRadius: '0.9rem',
  border: '1px solid rgba(148, 163, 184, 0.3)',
  background: '#ffffff',
  padding: '0.9rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.8rem',
};

const modalHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.6rem',
};

const modalTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.96rem',
  fontWeight: 700,
  color: '#0f172a',
};

const closeButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  padding: '0.36rem 0.68rem',
};

const modalBodyStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.68rem',
};

const inputLabelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.3rem',
  color: '#334155',
  fontSize: '0.76rem',
  fontWeight: 600,
};

const inputStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.38)',
  borderRadius: '0.5rem',
  padding: '0.5rem 0.62rem',
  fontSize: '0.82rem',
  color: '#0f172a',
  background: 'rgba(255, 255, 255, 0.94)',
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  minHeight: '5.8rem',
  resize: 'vertical',
};

const uploadButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 'fit-content',
  padding: '0.45rem 0.75rem',
  borderRadius: '0.48rem',
  border: '1px solid rgba(148, 163, 184, 0.4)',
  background: 'rgba(255, 255, 255, 0.9)',
  fontSize: '0.76rem',
  color: '#1f2937',
  cursor: 'pointer',
  fontWeight: 600,
};

const hiddenInputStyle: React.CSSProperties = {
  display: 'none',
};

const tabsRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.45rem',
};

const tabButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.4)',
  background: 'rgba(248, 250, 252, 0.9)',
  color: '#334155',
  borderRadius: '0.46rem',
  padding: '0.4rem 0.55rem',
  fontSize: '0.76rem',
  fontWeight: 700,
  cursor: 'pointer',
};

const tabButtonActiveStyle: React.CSSProperties = {
  borderColor: 'rgba(14, 116, 144, 0.58)',
  color: '#075985',
  background: 'linear-gradient(120deg, rgba(20, 184, 166, 0.2), rgba(14, 165, 233, 0.12))',
};

const pairingLayoutStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: '0.65rem',
};

const tabFormPanelStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.3)',
  borderRadius: '0.7rem',
  padding: '0.7rem',
  background: 'rgba(255, 255, 255, 0.94)',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.55rem',
};

const guidePanelStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.3)',
  borderRadius: '0.7rem',
  padding: '0.7rem',
  background: 'rgba(248, 250, 252, 0.92)',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.38rem',
};

const guideTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.82rem',
  fontWeight: 700,
  color: '#0f172a',
};

const guideTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.75rem',
  color: '#475569',
};

const linkButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  textDecoration: 'none',
};

const rechargeGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: '0.65rem',
};

const rechargeItemStyle: React.CSSProperties = {
  borderRadius: '0.7rem',
  border: '1px solid rgba(148, 163, 184, 0.3)',
  background: 'rgba(248, 250, 252, 0.92)',
  padding: '0.8rem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.5rem',
};

const rechargeNameStyle: React.CSSProperties = {
  fontSize: '0.86rem',
  fontWeight: 600,
  color: '#0f172a',
};

const rechargeStatusStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  color: '#64748b',
};
