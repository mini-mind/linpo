import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  API_BASE_URL,
  addModeratorNote,
  advanceDebateTurn,
  buildClawOptionLabel,
  createDebateSession,
  fetchHealth,
  fetchReplay,
  finishDebate,
  formatRegistrationStatusLabel,
  formatSourceLabel,
  listClawEndpoints,
  registerExternalClaw,
  requestExternalClawChallenge,
  runNextDebateTurn,
} from './api';
import type {
  ClawEndpoint,
  ExternalClawRegistrationRecord,
  RelayMessageRecord,
  SessionRecord,
} from './api';

function formatSessionStatus(status: string | undefined): string {
  if (status === 'closed') {
    return '已结束';
  }
  if (status === 'active') {
    return '进行中';
  }
  if (status === 'draft') {
    return '待开始';
  }
  return status ?? '未开始';
}

function formatDeliveryStatus(status: string): string {
  if (status === 'delivered') {
    return '已送达';
  }
  if (status === 'pending') {
    return '处理中';
  }
  if (status === 'failed') {
    return '失败';
  }
  return status;
}

function formatSpeakerName(message: RelayMessageRecord, session: SessionRecord | null): string {
  if (message.from_claw_id === 'moderator') {
    return '主持人';
  }
  return session?.participant_roles?.[message.from_claw_id] ?? message.from_claw_id;
}

function formatTargetName(message: RelayMessageRecord, session: SessionRecord | null): string {
  if (message.to_claw_id === 'all') {
    return '全体';
  }
  return session?.participant_roles?.[message.to_claw_id] ?? message.to_claw_id;
}

export default function App() {
  const [backendStatus, setBackendStatus] = useState<string>('checking');
  const [availableClaws, setAvailableClaws] = useState<ClawEndpoint[]>([]);
  const [currentSession, setCurrentSession] = useState<SessionRecord | null>(null);
  const [replayMessages, setReplayMessages] = useState<RelayMessageRecord[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [proposition, setProposition] = useState<string>('');
  const [selectedClaw1, setSelectedClaw1] = useState<string>('');
  const [selectedClaw2, setSelectedClaw2] = useState<string>('');
  const [roleLabel1, setRoleLabel1] = useState<string>('正方');
  const [roleLabel2, setRoleLabel2] = useState<string>('反方');
  const [moderatorNote, setModeratorNote] = useState<string>('');
  const [closingReason, setClosingReason] = useState<string>('讨论已收束');
  const isBusyRef = useRef(false);

  const [regDisplayName, setRegDisplayName] = useState<string>('');
  const [regDid, setRegDid] = useState<string>('');
  const [regAgentCardUrl, setRegAgentCardUrl] = useState<string>('');
  const [regInboxUrl, setRegInboxUrl] = useState<string>('');
  const [regChallengeId, setRegChallengeId] = useState<string>('');
  const [regChallengeSignature, setRegChallengeSignature] = useState<string>('');
  const [regStatus, setRegStatus] = useState<ExternalClawRegistrationRecord | null>(null);
  const [showRegPanel, setShowRegPanel] = useState<boolean>(false);

  const availableEnabledClaws = useMemo(
    () => availableClaws.filter((claw) => claw.enabled),
    [availableClaws],
  );
  const selectedClaw1Record = useMemo(
    () => availableEnabledClaws.find((claw) => claw.id === selectedClaw1) ?? null,
    [availableEnabledClaws, selectedClaw1],
  );
  const selectedClaw2Record = useMemo(
    () => availableEnabledClaws.find((claw) => claw.id === selectedClaw2) ?? null,
    [availableEnabledClaws, selectedClaw2],
  );

  const canCreateDebate = availableEnabledClaws.length >= 2;
  const hasActiveDebate = currentSession?.proposition;

  const withAction = useCallback(async <T,>(
    label: string,
    work: () => Promise<T>,
  ): Promise<T | null> => {
    if (isBusyRef.current) {
      return null;
    }

    isBusyRef.current = true;
    setBusyAction(label);
    setErrorMessage(null);

    try {
      return await work();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '发生未知错误');
      return null;
    } finally {
      setBusyAction(null);
      isBusyRef.current = false;
    }
  }, []);

  const loadOverview = useCallback(async () => {
    const result = await withAction('正在刷新状态', async () => {
      const [health, claws] = await Promise.all([fetchHealth(), listClawEndpoints()]);
      return { health, claws };
    });

    if (!result) {
      setBackendStatus('offline');
      return;
    }

    setBackendStatus(result.health.status);
    setAvailableClaws(result.claws);
  }, [withAction]);

  const loadReplay = useCallback(async (sessionId: string) => {
    const messages = await withAction('正在同步对话', () => fetchReplay(sessionId));
    if (messages) {
      setReplayMessages(messages);
    }
  }, [withAction]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  async function handleCreateDebate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!proposition.trim()) {
      setErrorMessage('请先输入辩题。');
      return;
    }
    if (!selectedClaw1 || !selectedClaw2) {
      setErrorMessage('请选择两位辩手。');
      return;
    }
    if (selectedClaw1 === selectedClaw2) {
      setErrorMessage('两位辩手不能重复。');
      return;
    }
    if (!roleLabel1.trim() || !roleLabel2.trim()) {
      setErrorMessage('请为双方填写角色名称。');
      return;
    }

    const session = await withAction('正在创建辩论', () =>
      createDebateSession({
        proposition: proposition.trim(),
        participants: [selectedClaw1, selectedClaw2],
        participant_roles: {
          [selectedClaw1]: roleLabel1.trim(),
          [selectedClaw2]: roleLabel2.trim(),
        },
      }),
    );

    if (!session) {
      return;
    }

    setCurrentSession(session);
    setReplayMessages([]);
    await loadReplay(session.id);
  }

  async function handleAddModeratorNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!currentSession) {
      setErrorMessage('请先开始一场辩论。');
      return;
    }
    if (!moderatorNote.trim()) {
      setErrorMessage('请输入主持人提示。');
      return;
    }

    const note = await withAction('正在发送主持人提示', () =>
      addModeratorNote(currentSession.id, { content: moderatorNote.trim() }),
    );

    if (!note) {
      return;
    }

    setModeratorNote('');
    await loadReplay(currentSession.id);
  }

  async function handleAdvanceTurn() {
    if (!currentSession) {
      setErrorMessage('请先开始一场辩论。');
      return;
    }

    const updated = await withAction('正在推进到下一回合', () =>
      advanceDebateTurn(currentSession.id),
    );

    if (!updated) {
      return;
    }

    setCurrentSession(updated);
  }

  async function handleRunNextTurn() {
    if (!currentSession) {
      setErrorMessage('请先开始一场辩论。');
      return;
    }

    const updated = await withAction('正在生成下一轮发言', () =>
      runNextDebateTurn(currentSession.id),
    );

    if (!updated) {
      return;
    }

    setCurrentSession(updated);
    await loadReplay(currentSession.id);
  }

  async function handleFinishDebate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!currentSession) {
      setErrorMessage('请先开始一场辩论。');
      return;
    }
    if (!closingReason.trim()) {
      setErrorMessage('请填写结束说明。');
      return;
    }

    const finished = await withAction('正在结束辩论', () =>
      finishDebate(currentSession.id, { closing_reason: closingReason.trim() }),
    );

    if (!finished) {
      return;
    }

    setCurrentSession(finished);
    await loadReplay(currentSession.id);
  }

  async function handleRequestChallenge() {
    if (!regDid.trim()) {
      setErrorMessage('请输入 DID。');
      return;
    }
    if (!regDid.startsWith('did:web:')) {
      setErrorMessage('目前仅支持 did:web 格式。');
      return;
    }

    const response = await withAction('正在请求 Challenge', () =>
      requestExternalClawChallenge({ did: regDid.trim() }),
    );

    if (response) {
      setRegChallengeId(response.id);
      setErrorMessage(null);
    }
  }

  async function handleRegisterExternalClaw(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!regDisplayName.trim()) {
      setErrorMessage('请输入显示名称。');
      return;
    }
    if (!regDid.trim()) {
      setErrorMessage('请输入 DID。');
      return;
    }
    if (!regAgentCardUrl.trim()) {
      setErrorMessage('请输入 Agent Card URL。');
      return;
    }
    if (!regInboxUrl.trim()) {
      setErrorMessage('请输入 Inbox URL。');
      return;
    }
    if (!regChallengeId) {
      setErrorMessage('请先请求 Challenge。');
      return;
    }
    if (!regChallengeSignature.trim()) {
      setErrorMessage('请输入 Challenge 签名。');
      return;
    }

    const record = await withAction('正在提交注册', () =>
      registerExternalClaw({
        display_name: regDisplayName.trim(),
        did: regDid.trim(),
        agent_card_url: regAgentCardUrl.trim(),
        inbox_url: regInboxUrl.trim(),
        challenge_id: regChallengeId,
        challenge_signature: regChallengeSignature.trim(),
      }),
    );

    if (record) {
      setRegStatus(record);
      setErrorMessage(null);
    }
  }

  function describeSelectedClaw(claw: ClawEndpoint): string {
    if (claw.source === 'external_registration') {
      return `来源：${formatSourceLabel(claw.source)} · 审核状态：${formatRegistrationStatusLabel(claw.registration_status)}`;
    }
    return `来源：${formatSourceLabel(claw.source)} · 平台内置实例`;
  }

  function describeRegistrationStatus(record: ExternalClawRegistrationRecord): string {
    if (record.status === 'approved') {
      return '已通过审核，之后会进入辩手池。';
    }
    if (record.status === 'rejected') {
      return '已拒绝，暂不会进入辩手池。';
    }
    return '待审核中，暂不会进入辩手池。';
  }

  const sessionParticipants = currentSession?.attached_claw_ids ?? [];

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <span className="hero-badge">灵盘 Linpo</span>
          <h1>让你像主持一场讨论一样，掌控多 AI 辩论。</h1>
          <p>
            用中文创建辩题、看双方轮流发言、随时插入主持人提示，最后收束成可回看的总结。
          </p>
        </div>

        <div className="hero-status-card">
          <div>
            <span className="status-label">服务状态</span>
            <strong>{backendStatus === 'ok' ? '在线' : backendStatus}</strong>
          </div>
          <div>
            <span className="status-label">可用辩手</span>
            <strong>{availableEnabledClaws.length}</strong>
          </div>
          <button type="button" onClick={() => void loadOverview()} disabled={!!busyAction}>
            刷新
          </button>
        </div>
      </section>

      {errorMessage ? <div className="banner error">{errorMessage}</div> : null}
      {busyAction ? <div className="banner">{busyAction}…</div> : null}

      <div className="console-layout">
        <section className="setup-panel card">
          <div className="section-head">
            <div>
              <p className="section-kicker">开始一场新辩论</p>
              <h2>先定题，再让双方开口</h2>
            </div>
            <span className="inline-note">API：{API_BASE_URL}</span>
          </div>

          <form className="setup-form" onSubmit={(event) => void handleCreateDebate(event)}>
            <label htmlFor="proposition">辩题</label>
            <textarea
              id="proposition"
              value={proposition}
              onChange={(event) => setProposition(event.target.value)}
              rows={3}
              placeholder="例如：AI 结对编程应该默认开启吗？"
              disabled={!!busyAction}
            />

            <div className="participant-grid">
              <div className="participant-card">
                <label htmlFor="claw-1">第一位辩手</label>
                <select
                  id="claw-1"
                  value={selectedClaw1}
                  onChange={(event) => setSelectedClaw1(event.target.value)}
                  disabled={!!busyAction || !canCreateDebate}
                >
                  <option value="">请选择</option>
                  {availableEnabledClaws
                    .filter((claw) => claw.id !== selectedClaw2)
                    .map((claw) => (
                      <option key={claw.id} value={claw.id}>
                       {buildClawOptionLabel(claw)}
                     </option>
                   ))}
                </select>
                <input
                  type="text"
                  value={roleLabel1}
                  onChange={(event) => setRoleLabel1(event.target.value)}
                  placeholder="角色名称，例如：支持方"
                  disabled={!!busyAction}
                />
                {selectedClaw1Record ? (
                  <p className="participant-meta">{describeSelectedClaw(selectedClaw1Record)}</p>
                ) : null}
              </div>

              <div className="participant-card">
                <label htmlFor="claw-2">第二位辩手</label>
                <select
                  id="claw-2"
                  value={selectedClaw2}
                  onChange={(event) => setSelectedClaw2(event.target.value)}
                  disabled={!!busyAction || !canCreateDebate}
                >
                  <option value="">请选择</option>
                  {availableEnabledClaws
                    .filter((claw) => claw.id !== selectedClaw1)
                    .map((claw) => (
                      <option key={claw.id} value={claw.id}>
                       {buildClawOptionLabel(claw)}
                     </option>
                   ))}
                </select>
                <input
                  type="text"
                  value={roleLabel2}
                  onChange={(event) => setRoleLabel2(event.target.value)}
                  placeholder="角色名称，例如：反对方"
                  disabled={!!busyAction}
                />
                {selectedClaw2Record ? (
                  <p className="participant-meta">{describeSelectedClaw(selectedClaw2Record)}</p>
                ) : null}
              </div>
            </div>

            <div className="form-footnote">
              {canCreateDebate
                ? '建议只保留最必要的设定：一个辩题、两位辩手、清晰角色。外部实例会在选择时标明来源与审核状态。'
                : '当前可用辩手不足两位，请先检查后端或本地 claw 配置。'}
            </div>

            <button type="submit" className="primary-button" disabled={!!busyAction || !canCreateDebate}>
              开始辩论
            </button>
          </form>
        </section>

        <section className="conversation-panel card">
          <div className="section-head">
            <div>
              <p className="section-kicker">聊天式控制台</p>
              <h2>{hasActiveDebate ? '当前辩论' : '还没有进行中的辩论'}</h2>
            </div>
            {currentSession ? (
              <span className={`session-status status-${currentSession.status}`}>
                {formatSessionStatus(currentSession.status)}
              </span>
            ) : null}
          </div>

          {currentSession ? (
            <>
              <div className="conversation-summary">
                <div>
                  <span className="status-label">辩题</span>
                  <strong>{currentSession.proposition ?? '未设置'}</strong>
                </div>
                <div>
                  <span className="status-label">当前回合</span>
                  <strong>第 {currentSession.current_turn} 回合</strong>
                </div>
                <div>
                  <span className="status-label">参与者</span>
                  <div className="participant-tags">
                    {sessionParticipants.map((id) => (
                      <span key={id} className="participant-tag">
                        {currentSession.participant_roles?.[id] ?? id}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="action-bar">
                <button type="button" onClick={() => void handleRunNextTurn()} disabled={!!busyAction || currentSession.status === 'closed'}>
                  生成下一轮
                </button>
                <button type="button" onClick={() => void handleAdvanceTurn()} disabled={!!busyAction || currentSession.status === 'closed'}>
                  仅推进回合
                </button>
                <button type="button" onClick={() => void loadReplay(currentSession.id)} disabled={!!busyAction}>
                  刷新记录
                </button>
              </div>

              <div className="message-stream">
                {replayMessages.length === 0 ? (
                  <div className="empty-state">
                    <strong>对话还没开始</strong>
                    <p>先点击“生成下一轮”，或先发一条主持人提示。</p>
                  </div>
                ) : (
                  replayMessages.map((message) => {
                    const isModerator = message.from_claw_id === 'moderator';
                    return (
                      <article
                        key={message.id}
                        className={`message-bubble ${isModerator ? 'moderator' : 'debater'}`}
                      >
                        <div className="message-head">
                          <div>
                            <strong>{formatSpeakerName(message, currentSession)}</strong>
                            <span> → {formatTargetName(message, currentSession)}</span>
                          </div>
                          <span className="message-turn">第 {message.turn_index} 回合</span>
                        </div>
                        <p>{message.content}</p>
                        <div className="message-meta">
                          <span>{formatDeliveryStatus(message.delivery_status)}</span>
                          <span>{message.delivery_error ?? '无异常'}</span>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </>
          ) : (
            <div className="empty-state large">
              <strong>先创建一场辩论</strong>
              <p>左侧填好辩题和双方角色，这里就会变成你的主持面板。</p>
            </div>
          )}
        </section>

        <section className="moderator-panel card">
          <div className="section-head compact">
            <div>
              <p className="section-kicker">主持人操作</p>
              <h2>插一句话，调整节奏</h2>
            </div>
          </div>

          <form className="moderator-form" onSubmit={(event) => void handleAddModeratorNote(event)}>
            <label htmlFor="moderator-note">主持人提示</label>
            <textarea
              id="moderator-note"
              value={moderatorNote}
              onChange={(event) => setModeratorNote(event.target.value)}
              rows={4}
              placeholder="例如：请双方各用一段话回应对方最强论点。"
              disabled={!currentSession || !!busyAction}
            />
            <button type="submit" disabled={!currentSession || !!busyAction}>
              发送提示
            </button>
          </form>

          <form className="finish-form" onSubmit={(event) => void handleFinishDebate(event)}>
            <label htmlFor="closing-reason">结束说明</label>
            <input
              id="closing-reason"
              type="text"
              value={closingReason}
              onChange={(event) => setClosingReason(event.target.value)}
              placeholder="例如：核心分歧已充分展开"
              disabled={!currentSession || !!busyAction || currentSession.status === 'closed'}
            />
            <button
              type="submit"
              className="secondary-button"
              disabled={!currentSession || !!busyAction || currentSession.status === 'closed'}
            >
              结束辩论
            </button>
          </form>
        </section>

        <section className="summary-panel card">
          <div className="section-head compact">
            <div>
              <p className="section-kicker">结果摘要</p>
              <h2>最后得到什么</h2>
            </div>
          </div>

          {currentSession?.summary ? (
            <dl className="summary-list">
              <div>
                <dt>总消息数</dt>
                <dd>{currentSession.summary.total_messages}</dd>
              </div>
              <div>
                <dt>总回合数</dt>
                <dd>{currentSession.summary.total_turns}</dd>
              </div>
              <div>
                <dt>主持人提示</dt>
                <dd>{currentSession.summary.moderator_note_count}</dd>
              </div>
              <div>
                <dt>结束原因</dt>
                <dd>{currentSession.summary.closing_reason}</dd>
              </div>
              <div>
                <dt>最后发言时间</dt>
                <dd>{currentSession.summary.last_message_at ?? '暂无'}</dd>
              </div>
            </dl>
          ) : (
            <div className="empty-state">
              <strong>还没有摘要</strong>
              <p>辩论结束后，这里会显示可复盘的结果概览。</p>
            </div>
          )}
        </section>

        <section className="registration-panel card">
          <div className="section-head compact">
            <div>
              <p className="section-kicker">外部 OpenClaw 接入</p>
              <h2>高级接入（可选）</h2>
            </div>
            <button
              type="button"
              className="toggle-button"
              onClick={() => setShowRegPanel(!showRegPanel)}
            >
              {showRegPanel ? '收起高级入口' : '展开高级入口'}
            </button>
          </div>

          <div className="registration-intro">
            <p>主流程仍然是创建并主持辩论；只有要把自己的 OpenClaw 纳入辩手池时，才使用这里的高级注册入口。</p>
            <p>接入方式保持直接 RESTful 请求：请求 Challenge → 本地签名 → 提交注册 → 等待审核。</p>
          </div>

          <div className={`registration-status-summary ${regStatus ? `status-${regStatus.status}` : 'status-idle'}`}>
            <div className="registration-status-head">
              <span>来源：外部接入</span>
              <strong>审核状态：{regStatus ? formatRegistrationStatusLabel(regStatus.status) : '未提交'}</strong>
            </div>
            <p>
              {regStatus
                ? `${regStatus.display_name}：${describeRegistrationStatus(regStatus)}`
                : '提交后会先进入待审核；只有已通过审核的实例才会进入辩手池。'}
            </p>
          </div>

          {showRegPanel && (
            <form className="registration-form" onSubmit={(event) => void handleRegisterExternalClaw(event)}>
              <div className="registration-flow">
                <strong>最小接入顺序</strong>
                <span>1. 填写实例信息与 DID</span>
                <span>2. 请求 Challenge 并在本地完成签名</span>
                <span>3. 直接提交注册 API，进入待审核状态</span>
              </div>

              <label htmlFor="reg-display-name">显示名称</label>
              <input
                id="reg-display-name"
                type="text"
                value={regDisplayName}
                onChange={(event) => setRegDisplayName(event.target.value)}
                placeholder="例如：My External Claw"
                disabled={!!busyAction}
              />

              <label htmlFor="reg-did">DID（did:web 格式）</label>
              <input
                id="reg-did"
                type="text"
                value={regDid}
                onChange={(event) => setRegDid(event.target.value)}
                placeholder="例如：did:web:example.com"
                disabled={!!busyAction}
              />

              <label htmlFor="reg-agent-card-url">Agent Card URL</label>
              <input
                id="reg-agent-card-url"
                type="text"
                value={regAgentCardUrl}
                onChange={(event) => setRegAgentCardUrl(event.target.value)}
                placeholder="例如：https://example.com/.well-known/agent-card.json"
                disabled={!!busyAction}
              />

              <label htmlFor="reg-inbox-url">Inbox URL</label>
              <input
                id="reg-inbox-url"
                type="text"
                value={regInboxUrl}
                onChange={(event) => setRegInboxUrl(event.target.value)}
                placeholder="例如：https://example.com/inbox"
                disabled={!!busyAction}
              />

              <div className="challenge-row">
                <button
                  type="button"
                  onClick={() => void handleRequestChallenge()}
                  disabled={!!busyAction || !regDid}
                >
                  1. 请求 Challenge
                </button>
                {regChallengeId && (
                  <span className="challenge-hint">Challenge ID: {regChallengeId.slice(0, 8)}...</span>
                )}
              </div>

              <label htmlFor="reg-challenge-signature">Challenge 签名</label>
              <input
                id="reg-challenge-signature"
                type="text"
                value={regChallengeSignature}
                onChange={(event) => setRegChallengeSignature(event.target.value)}
                placeholder="使用 DID 私钥对 Challenge 签名"
                disabled={!!busyAction}
              />

              {regStatus && (
                <div className={`reg-status reg-status-${regStatus.status}`}>
                  注册状态：{formatRegistrationStatusLabel(regStatus.status)}。
                  {regStatus.status === 'approved'
                    ? ' 已通过审核，可在辩手池中查看。'
                    : ' 暂不可参赛。'}
                </div>
              )}

              <button type="submit" className="primary-button" disabled={!!busyAction}>
                3. 提交注册
              </button>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
