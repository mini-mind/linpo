import {
  API_BASE_URL,
  type ClawEndpoint,
  type EchoCallbackResponse,
  type ProtocolGuide,
  type ProtocolTestResponse,
  type RelayMessageRecord,
  type SessionRecord,
  addModeratorNote,
  advanceDebateTurn,
  attachParticipants,
  createDebateSession,
  createSession,
  fetchHealth,
  fetchProtocolGuide,
  fetchProtocolTest,
  fetchReplay,
  finishDebate,
  listClawEndpoints,
  relayMessage,
  runNextDebateTurn,
  sendEchoCallback,
} from './api';
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const DEFAULT_ATTACH_IDS = ['local-claw-1', 'local-claw-2'];
const DEFAULT_RELAY_MESSAGE = 'hello from linpo';

function Section(props: { title: string; eyebrow: string; children: ReactNode }) {
  return (
    <section className="panel">
      <p className="panel-eyebrow">{props.eyebrow}</p>
      <div className="panel-heading">
        <h2>{props.title}</h2>
      </div>
      {props.children}
    </section>
  );
}

export default function App() {
  const [backendStatus, setBackendStatus] = useState<string>('checking');
  const [availableClaws, setAvailableClaws] = useState<ClawEndpoint[]>([]);
  const [currentSession, setCurrentSession] = useState<SessionRecord | null>(null);
  const [relayPayload, setRelayPayload] = useState<string>(DEFAULT_RELAY_MESSAGE);
  const [lastRelay, setLastRelay] = useState<RelayMessageRecord | null>(null);
  const [replayMessages, setReplayMessages] = useState<RelayMessageRecord[]>([]);
  const [protocolGuide, setProtocolGuide] = useState<ProtocolGuide | null>(null);
  const [protocolTest, setProtocolTest] = useState<ProtocolTestResponse | null>(null);
  const [echoResult, setEchoResult] = useState<EchoCallbackResponse | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const isBusyRef = useRef(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [proposition, setProposition] = useState<string>('');
  const [selectedClaw1, setSelectedClaw1] = useState<string>('');
  const [selectedClaw2, setSelectedClaw2] = useState<string>('');
  const [roleLabel1, setRoleLabel1] = useState<string>('');
  const [roleLabel2, setRoleLabel2] = useState<string>('');
  const [moderatorNote, setModeratorNote] = useState<string>('');
  const [closingReason, setClosingReason] = useState<string>('');

  const attachedPair = useMemo(() => {
    if (!currentSession || currentSession.attached_claw_ids.length < 2) {
      return null;
    }
    return {
      from: currentSession.attached_claw_ids[0],
      to: currentSession.attached_claw_ids[1],
    };
  }, [currentSession]);

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
      setErrorMessage(error instanceof Error ? error.message : 'Unknown error');
      return null;
    } finally {
      setBusyAction(null);
      isBusyRef.current = false;
    }
  }, []);

  const loadOverview = useCallback(async () => {
    const result = await withAction('Refreshing backend overview', async () => {
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

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  async function handleCreateSession() {
    const session = await withAction('Creating session', () => createSession());
    if (!session) {
      return;
    }
    setCurrentSession(session);
    setLastRelay(null);
    setReplayMessages([]);
  }

  async function handleAttachDefaults() {
    if (!currentSession) {
      setErrorMessage('Create a session before attaching claws.');
      return;
    }

    const updated = await withAction('Attaching local claws', () =>
      attachParticipants(currentSession.id, DEFAULT_ATTACH_IDS),
    );
    if (!updated) {
      return;
    }
    setCurrentSession(updated);
  }

  async function handleRelay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentSession || !attachedPair) {
      setErrorMessage('Attach two claws before sending a relay message.');
      return;
    }

    const relayed = await withAction('Relaying message', () =>
      relayMessage(currentSession.id, {
        from_claw_id: attachedPair.from,
        to_claw_id: attachedPair.to,
        content: relayPayload,
      }),
    );
    if (!relayed) {
      return;
    }

    setLastRelay(relayed);
    await handleReplay();
  }

  async function handleReplay() {
    if (!currentSession) {
      setErrorMessage('Create a session before loading replay.');
      return;
    }

    const messages = await withAction('Loading replay', () => fetchReplay(currentSession.id));
    if (!messages) {
      return;
    }
    setReplayMessages(messages);
  }

  async function handleLoadProtocolGuide() {
    const guide = await withAction('Loading protocol guide', () => fetchProtocolGuide());
    if (guide) {
      setProtocolGuide(guide);
    }
  }

  async function handleLoadProtocolTest() {
    const testPayload = await withAction('Loading protocol test', () => fetchProtocolTest());
    if (testPayload) {
      setProtocolTest(testPayload);
    }
  }

  async function handleSendEcho() {
    let currentTest = protocolTest;
    if (!currentTest) {
      currentTest = await withAction('Loading protocol test', () => fetchProtocolTest());
      if (!currentTest) {
        return;
      }
      setProtocolTest(currentTest);
    }

    const echoEntry = currentTest.available_tests[0];
    const result = await withAction('Sending echo callback', () => sendEchoCallback(echoEntry.request_body));
    if (result) {
      setEchoResult(result);
    }
  }

  async function handleCreateDebate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!proposition.trim()) {
      setErrorMessage('Please enter a proposition.');
      return;
    }
    if (!selectedClaw1 || !selectedClaw2) {
      setErrorMessage('Please select two claws.');
      return;
    }
    if (selectedClaw1 === selectedClaw2) {
      setErrorMessage('Please select two different claws.');
      return;
    }
    if (!roleLabel1.trim() || !roleLabel2.trim()) {
      setErrorMessage('Please enter role labels for both claws.');
      return;
    }

    const session = await withAction('Creating debate session', () =>
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
    setLastRelay(null);
    setReplayMessages([]);
  }

  async function handleAddModeratorNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!currentSession) {
      setErrorMessage('Create a debate session first.');
      return;
    }
    if (!moderatorNote.trim()) {
      setErrorMessage('Please enter a moderator note.');
      return;
    }

    const note = await withAction('Adding moderator note', () =>
      addModeratorNote(currentSession.id, { content: moderatorNote.trim() }),
    );

    if (!note) {
      return;
    }

    setModeratorNote('');
    await handleReplay();
  }

  async function handleAdvanceTurn() {
    if (!currentSession) {
      setErrorMessage('Create a debate session first.');
      return;
    }

    const updated = await withAction('Advancing turn', () => advanceDebateTurn(currentSession.id));
    if (!updated) {
      return;
    }

    setCurrentSession(updated);
  }

  async function handleRunNextTurn() {
    if (!currentSession) {
      setErrorMessage('Create a debate session first.');
      return;
    }

    const updated = await withAction('Running next turn', () => runNextDebateTurn(currentSession.id));
    if (!updated) {
      return;
    }

    setCurrentSession(updated);
    await handleReplay();
  }

  async function handleFinishDebate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!currentSession) {
      setErrorMessage('Create a debate session first.');
      return;
    }
    if (!closingReason.trim()) {
      setErrorMessage('Please enter a closing reason.');
      return;
    }

    const finished = await withAction('Finishing debate', () =>
      finishDebate(currentSession.id, { closing_reason: closingReason.trim() }),
    );

    if (!finished) {
      return;
    }

    setCurrentSession(finished);
    setClosingReason('');
    await handleReplay();
  }

  return (
    <main className="shell">
      <div className="hero-card">
        <div>
          <p className="hero-kicker">Linpo Visible MVP</p>
          <h1>Real local claws, one page, no dashboard sprawl.</h1>
        </div>
        <div className="hero-meta">
          <span>API base</span>
          <code>{API_BASE_URL}</code>
        </div>
      </div>

      {errorMessage ? <div className="status-banner error">{errorMessage}</div> : null}
      {busyAction ? <div className="status-banner">{busyAction}...</div> : null}

      <div className="grid-layout">
        <Section title="Backend Status" eyebrow="01 / health">
          <div className="metric-row">
            <div>
              <span className="metric-label">Service</span>
              <strong>{backendStatus}</strong>
            </div>
            <button type="button" onClick={() => void loadOverview()} disabled={!!busyAction}>
              Refresh overview
            </button>
          </div>
        </Section>

        <Section title="Available Claws" eyebrow="02 / local docker endpoints">
          <div className="stack-list">
            {availableClaws.map((claw) => (
              <article className="endpoint-card" key={claw.id}>
                <div>
                  <h3>{claw.name}</h3>
                  <p>{claw.id}</p>
                </div>
                <dl>
                  <div>
                    <dt>Endpoint</dt>
                    <dd>{claw.endpoint_ref}</dd>
                  </div>
                  <div>
                    <dt>Inbox</dt>
                    <dd>{claw.inbox_url ?? 'none'}</dd>
                  </div>
                  <div>
                    <dt>Enabled</dt>
                    <dd>{String(claw.enabled)}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </Section>

        <Section title="Debate Setup" eyebrow="03 / create debate">
          <form className="debate-form" onSubmit={(event) => void handleCreateDebate(event)}>
            <label htmlFor="proposition">Proposition</label>
            <textarea
              id="proposition"
              value={proposition}
              onChange={(event) => setProposition(event.target.value)}
              rows={2}
              placeholder="Enter the debate proposition..."
              disabled={!!busyAction}
            />

            <div className="claw-selectors">
              <div className="claw-select-group">
                <label htmlFor="claw-1">Claw 1</label>
                <select
                  id="claw-1"
                  value={selectedClaw1}
                  onChange={(event) => setSelectedClaw1(event.target.value)}
                  disabled={!!busyAction}
                >
                  <option value="">Select a claw</option>
                  {availableClaws
                    .filter((claw) => claw.enabled && claw.id !== selectedClaw2)
                    .map((claw) => (
                      <option key={claw.id} value={claw.id}>
                        {claw.name} ({claw.id})
                      </option>
                    ))}
                </select>
                <input
                  type="text"
                  value={roleLabel1}
                  onChange={(event) => setRoleLabel1(event.target.value)}
                  placeholder="Role label (e.g., 正方)"
                  className="role-input"
                  disabled={!!busyAction}
                />
              </div>

              <div className="claw-select-group">
                <label htmlFor="claw-2">Claw 2</label>
                <select
                  id="claw-2"
                  value={selectedClaw2}
                  onChange={(event) => setSelectedClaw2(event.target.value)}
                  disabled={!!busyAction}
                >
                  <option value="">Select a claw</option>
                  {availableClaws
                    .filter((claw) => claw.enabled && claw.id !== selectedClaw1)
                    .map((claw) => (
                      <option key={claw.id} value={claw.id}>
                        {claw.name} ({claw.id})
                      </option>
                    ))}
                </select>
                <input
                  type="text"
                  value={roleLabel2}
                  onChange={(event) => setRoleLabel2(event.target.value)}
                  placeholder="Role label (e.g., 反方)"
                  className="role-input"
                  disabled={!!busyAction}
                />
              </div>
            </div>

            <button type="submit" disabled={!!busyAction}>Create debate session</button>
          </form>

          {currentSession?.proposition && (
            <div className="debate-summary detail-card">
              <h3>Debate Status</h3>
              <dl className="summary-grid compact">
                <div>
                  <dt>Session ID</dt>
                  <dd>{currentSession.id}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd className={currentSession.status === 'closed' ? 'status-closed' : 'status-active'}>
                    {currentSession.status}
                  </dd>
                </div>
                <div>
                  <dt>Current Turn</dt>
                  <dd>{currentSession.current_turn}</dd>
                </div>
                <div>
                  <dt>Closed At</dt>
                  <dd>{currentSession.closed_at ?? 'N/A'}</dd>
                </div>
                <div className="span-full">
                  <dt>Proposition</dt>
                  <dd>{currentSession.proposition ?? 'N/A'}</dd>
                </div>
                <div className="span-full">
                  <dt>Participants</dt>
                  <dd>
                    {currentSession.attached_claw_ids.map((id) => (
                      <span key={id} className="participant-tag">
                        {id} ({currentSession.participant_roles?.[id] ?? 'unknown'})
                      </span>
                    ))}
                  </dd>
                </div>
              </dl>

              {currentSession.summary && (
                <div className="summary-section">
                  <h4>Debate Summary</h4>
                  <dl className="summary-grid compact">
                    <div>
                      <dt>Total Messages</dt>
                      <dd>{currentSession.summary.total_messages}</dd>
                    </div>
                    <div>
                      <dt>Total Turns</dt>
                      <dd>{currentSession.summary.total_turns}</dd>
                    </div>
                    <div>
                      <dt>Moderator Notes</dt>
                      <dd>{currentSession.summary.moderator_note_count}</dd>
                    </div>
                    <div>
                      <dt>Closing Reason</dt>
                      <dd>{currentSession.summary.closing_reason}</dd>
                    </div>
                    <div className="span-full">
                      <dt>Last Message At</dt>
                      <dd>{currentSession.summary.last_message_at ?? 'N/A'}</dd>
                    </div>
                  </dl>
                </div>
              )}

              {currentSession.status !== 'closed' && (
                <div className="debate-controls">
                  <div className="action-row wrap">
                    <button type="button" onClick={() => void handleAdvanceTurn()} disabled={!!busyAction}>
                      Advance turn
                    </button>
                    <button type="button" onClick={() => void handleRunNextTurn()} disabled={!!busyAction}>
                      Run next turn
                    </button>
                  </div>
                  <form className="finish-form" onSubmit={(event) => void handleFinishDebate(event)}>
                    <input
                      type="text"
                      value={closingReason}
                      onChange={(event) => setClosingReason(event.target.value)}
                      placeholder="Closing reason (e.g., debate concluded)"
                      className="closing-reason-input"
                      disabled={!!busyAction}
                    />
                    <button type="submit" disabled={!!busyAction}>Finish debate</button>
                  </form>
                </div>
              )}
            </div>
          )}
        </Section>

        <Section title="Moderator Note" eyebrow="04 / add note">
          <form className="moderator-form" onSubmit={(event) => void handleAddModeratorNote(event)}>
            <label htmlFor="moderator-note">Moderator message</label>
            <textarea
              id="moderator-note"
              value={moderatorNote}
              onChange={(event) => setModeratorNote(event.target.value)}
              rows={3}
              placeholder="Enter your moderator note..."
              disabled={!currentSession || !!busyAction}
            />
            <button type="submit" disabled={!currentSession || !!busyAction}>
              Add moderator note
            </button>
          </form>
        </Section>

        <Section title="Session Flow" eyebrow="05 / create attach relay">
          <div className="action-row">
            <button type="button" onClick={() => void handleCreateSession()} disabled={!!busyAction}>
              Create session
            </button>
            <button type="button" onClick={() => void handleAttachDefaults()} disabled={!!busyAction}>
              Attach local-claw-1 + local-claw-2
            </button>
          </div>

          <dl className="summary-grid">
            <div>
              <dt>Session ID</dt>
              <dd>{currentSession?.id ?? 'not created'}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{currentSession?.status ?? 'n/a'}</dd>
            </div>
            <div>
              <dt>Participants</dt>
              <dd>{currentSession?.attached_claw_ids.join(', ') || 'none attached'}</dd>
            </div>
          </dl>

          <form className="relay-form" onSubmit={(event) => void handleRelay(event)}>
            <label htmlFor="relay-message">Relay message</label>
            <textarea
              id="relay-message"
              value={relayPayload}
              onChange={(event) => setRelayPayload(event.target.value)}
              rows={4}
              disabled={!!busyAction}
            />
            <button type="submit" disabled={!!busyAction}>Send relay</button>
          </form>

          <div className="detail-card">
            <h3>Last relay</h3>
            {lastRelay ? (
              <dl className="summary-grid compact">
                <div>
                  <dt>Route</dt>
                  <dd>
                    {lastRelay.from_claw_id} -&gt; {lastRelay.to_claw_id}
                  </dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{lastRelay.delivery_status}</dd>
                </div>
                <div>
                  <dt>Content</dt>
                  <dd>{lastRelay.content}</dd>
                </div>
                <div>
                  <dt>Error</dt>
                  <dd>{lastRelay.delivery_error ?? 'none'}</dd>
                </div>
              </dl>
            ) : (
              <p className="muted">No relay sent yet.</p>
            )}
          </div>
        </Section>

        <Section title="Replay" eyebrow="06 / message history">
          <div className="action-row">
            <button type="button" onClick={() => void handleReplay()} disabled={!!busyAction}>
              Refresh replay
            </button>
          </div>
          <div className="stack-list">
            {replayMessages.length === 0 ? (
              <p className="muted">Replay is empty.</p>
            ) : (
              replayMessages.map((message) => (
                <article className="message-card" key={message.id}>
                  <div className="message-route">
                    <span className="turn-badge">Turn {message.turn_index}</span>
                    <strong>{message.from_claw_id}</strong>
                    <span>to</span>
                    <strong>{message.to_claw_id}</strong>
                  </div>
                  <p>{message.content}</p>
                  <div className="message-meta">
                    <span>{message.delivery_status}</span>
                    <span>{message.delivery_error ?? 'delivered cleanly'}</span>
                  </div>
                </article>
              ))
            )}
          </div>
        </Section>

        <Section title="Protocol / Callback Echo" eyebrow="07 / verification">
          <div className="action-row wrap">
            <button type="button" onClick={() => void handleLoadProtocolGuide()} disabled={!!busyAction}>
              Load /protocol/claw
            </button>
            <button type="button" onClick={() => void handleLoadProtocolTest()} disabled={!!busyAction}>
              Load /protocol/claw/test
            </button>
            <button type="button" onClick={() => void handleSendEcho()} disabled={!!busyAction}>
              Send echo callback
            </button>
          </div>

          <div className="detail-card">
            <h3>Protocol guide</h3>
            {protocolGuide ? (
              <>
                <p>
                  {protocolGuide.name} v{protocolGuide.version}
                </p>
                <ul>
                  {protocolGuide.prerequisites.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="muted">Guide not loaded.</p>
            )}
          </div>

          <div className="detail-card">
            <h3>Protocol test</h3>
            {protocolTest ? (
              <>
                <p>{protocolTest.name}</p>
                <pre>{JSON.stringify(protocolTest.available_tests[0]?.request_body ?? {}, null, 2)}</pre>
              </>
            ) : (
              <p className="muted">Test payload not loaded.</p>
            )}
          </div>

          <div className="detail-card">
            <h3>Echo result</h3>
            {echoResult ? (
              <dl className="summary-grid compact">
                <div>
                  <dt>Matched</dt>
                  <dd>{String(echoResult.verification.matched)}</dd>
                </div>
                <div>
                  <dt>Message</dt>
                  <dd>{echoResult.verification.message}</dd>
                </div>
              </dl>
            ) : (
              <p className="muted">No callback sent yet.</p>
            )}
          </div>
        </Section>
      </div>
    </main>
  );
}
