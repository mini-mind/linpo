(() => {
  const byId = (id) => document.getElementById(id);
  const safeText = (value) => (value == null ? "" : String(value));

  const STORAGE = {
    runId: "roboard_run_id",
    inputNl: "roboard_run_input_nl",
    lang: "roboard_lang"
  };

  const STRINGS = {
    en: {
      "login.pageTitle": "RoBoard Login",
      "login.kicker": "Cockpit access",
      "login.title": "Sign In",
      "login.meta": "Cookie auth",
      "login.email": "Email",
      "login.password": "Password",
      "login.loginBtn": "Login",
      "login.registerBtn": "Register",
      "login.msg.sessionCheck": "Checking session...",
      "login.msg.emailRequired": "Email and password required.",
      "login.msg.loggingIn": "Logging in...",
      "login.msg.registering": "Registering...",
      "login.msg.loginFailed": "Login failed",
      "login.msg.registerFailed": "Register failed",

      "cockpit.pageTitle": "RoBoard Cockpit",
      "cockpit.kicker": "MVP(1) cockpit: runs • agent tree • SOP intervention • event stream",
      "cockpit.logout": "Logout",

      "run.title": "Run",
      "run.inputLabel": "input_nl",
      "run.inputPlaceholder": "Describe what you want this run to do...",
      "run.create": "Create Run",
      "run.advancedTitle": "Advanced",
      "run.advancedHint": "Connect / disconnect",
      "run.disconnect": "Disconnect",
      "run.idLabel": "run_id",
      "run.idPlaceholder": "Run ID",
      "run.connect": "Connect",
      "run.status.idle": "Idle",
      "run.status.connecting": "Connecting",
      "run.status.connected": "Connected",
      "run.status.closed": "Closed",
      "run.status.error": "Error",
      "run.msg.loginRequired": "Session required. Please login.",
      "run.msg.createRunHint": "Create a run, then connect.",
      "run.msg.creating": "Creating run...",
      "run.msg.createMissingInput": "Missing input_nl.",
      "run.msg.createMissingId": "Create run succeeded but response was missing run_id.",
      "run.msg.runCreated": "Run created",
      "run.msg.missingRunId": "Missing run_id.",
      "run.msg.connectingTo": "Connecting to",
      "run.msg.connected": "Connected.",
      "run.msg.disconnected": "Disconnected.",
      "run.msg.wsError": "WebSocket error.",
      "run.msg.disconnectOk": "Disconnected.",
      "run.msg.cleared": "(cleared)",

      "agents.title": "Agent Tree",
      "agents.count.one": "agent",
      "agents.count.many": "agents",
      "agents.empty": "No agents yet.",

      "sop.title": "SOP",
      "sop.noAgent": "No agent",
      "sop.view": "View SOP",
      "sop.viewHint": "Markdown",
      "sop.replace": "Replace SOP",
      "sop.replaceHint": "Intervention",
      "sop.replaceLabel": "Replace SOP (md_text)",
      "sop.replacePlaceholder": "Write replacement SOP markdown...",
      "sop.advanced": "Advanced",
      "sop.submit": "Submit",
      "sop.msg.selectAgent": "Select an agent first to edit SOP.",
      "sop.msg.fetching": "Fetching SOP for",
      "sop.msg.loaded": "SOP loaded.",
      "sop.msg.fetchFailed": "Fetch SOP failed",
      "sop.msg.replaceSubmitting": "Submitting SOP replace...",
      "sop.msg.replaceSubmitted": "SOP replace submitted. Refreshing...",
      "sop.msg.replaceFailed": "SOP replace failed",
      "sop.msg.missingExpected": "Missing expected_version (load SOP first).",
      "sop.msg.missingMd": "md_text is empty.",
      "sop.msg.needRun": "Missing run_id.",
      "sop.msg.needAgent": "Select an agent first.",

      "events.title": "Event Log",
      "events.hint": "Stream",
      "events.heading": "Events",
      "events.clear": "Clear",

      "logout.msg.loggingOut": "Logging out..."
    },
    zh: {
      "login.pageTitle": "RoBoard 登录",
      "login.kicker": "进入驾驶舱",
      "login.title": "登录",
      "login.meta": "Cookie 登录",
      "login.email": "邮箱",
      "login.password": "密码",
      "login.loginBtn": "登录",
      "login.registerBtn": "注册",
      "login.msg.sessionCheck": "检查登录状态...",
      "login.msg.emailRequired": "需要填写邮箱和密码。",
      "login.msg.loggingIn": "正在登录...",
      "login.msg.registering": "正在注册...",
      "login.msg.loginFailed": "登录失败",
      "login.msg.registerFailed": "注册失败",

      "cockpit.pageTitle": "RoBoard 驾驶舱",
      "cockpit.kicker": "MVP(1) 驾驶舱：运行 • 代理树 • SOP 介入 • 事件流",
      "cockpit.logout": "退出",

      "run.title": "运行",
      "run.inputLabel": "input_nl",
      "run.inputPlaceholder": "描述这次运行要做什么...",
      "run.create": "创建运行",
      "run.advancedTitle": "高级",
      "run.advancedHint": "连接 / 断开",
      "run.disconnect": "断开",
      "run.idLabel": "run_id",
      "run.idPlaceholder": "运行 ID",
      "run.connect": "连接",
      "run.status.idle": "空闲",
      "run.status.connecting": "连接中",
      "run.status.connected": "已连接",
      "run.status.closed": "已断开",
      "run.status.error": "错误",
      "run.msg.loginRequired": "需要登录会话，请先登录。",
      "run.msg.createRunHint": "先创建运行，再连接。",
      "run.msg.creating": "正在创建运行...",
      "run.msg.createMissingInput": "缺少 input_nl。",
      "run.msg.createMissingId": "创建成功，但响应缺少 run_id。",
      "run.msg.runCreated": "已创建运行",
      "run.msg.missingRunId": "缺少 run_id。",
      "run.msg.connectingTo": "正在连接",
      "run.msg.connected": "已连接。",
      "run.msg.disconnected": "已断开。",
      "run.msg.wsError": "WebSocket 错误。",
      "run.msg.disconnectOk": "已断开。",
      "run.msg.cleared": "(已清空)",

      "agents.title": "代理树",
      "agents.count.one": "代理",
      "agents.count.many": "代理",
      "agents.empty": "暂无代理。",

      "sop.title": "SOP",
      "sop.noAgent": "未选择代理",
      "sop.view": "查看 SOP",
      "sop.viewHint": "Markdown",
      "sop.replace": "替换 SOP",
      "sop.replaceHint": "介入",
      "sop.replaceLabel": "替换 SOP (md_text)",
      "sop.replacePlaceholder": "填写要替换的 SOP Markdown...",
      "sop.advanced": "高级",
      "sop.submit": "提交",
      "sop.msg.selectAgent": "先选择代理，再编辑 SOP。",
      "sop.msg.fetching": "正在获取 SOP：",
      "sop.msg.loaded": "SOP 已加载。",
      "sop.msg.fetchFailed": "获取 SOP 失败",
      "sop.msg.replaceSubmitting": "正在提交 SOP 替换...",
      "sop.msg.replaceSubmitted": "已提交 SOP 替换，正在刷新...",
      "sop.msg.replaceFailed": "SOP 替换失败",
      "sop.msg.missingExpected": "缺少 expected_version（请先加载 SOP）。",
      "sop.msg.missingMd": "md_text 为空。",
      "sop.msg.needRun": "缺少 run_id。",
      "sop.msg.needAgent": "请先选择代理。",

      "events.title": "事件日志",
      "events.hint": "流式",
      "events.heading": "事件",
      "events.clear": "清空",

      "logout.msg.loggingOut": "正在退出..."
    }
  };

  const detectLang = () => {
    const stored = safeText(localStorage.getItem(STORAGE.lang)).trim().toLowerCase();
    if (stored === "zh" || stored === "en") return stored;
    const nav = safeText(navigator.language || navigator.userLanguage).toLowerCase();
    return nav.startsWith("zh") ? "zh" : "en";
  };

  let lang = detectLang();

  const t = (key) => {
    const k = safeText(key);
    const dict = STRINGS[lang] || STRINGS.en;
    return dict[k] != null ? dict[k] : STRINGS.en[k] != null ? STRINGS.en[k] : k;
  };

  const applyI18n = () => {
    document.documentElement.lang = lang;
    const isLogin = Boolean(byId("login-form"));
    document.title = isLogin ? t("login.pageTitle") : t("cockpit.pageTitle");

    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (key) el.textContent = t(key);
    });

    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.getAttribute("data-i18n-placeholder");
      if (key) el.setAttribute("placeholder", t(key));
    });
  };

  const setLang = (next) => {
    const n = safeText(next).trim().toLowerCase();
    if (n !== "zh" && n !== "en") return;
    lang = n;
    localStorage.setItem(STORAGE.lang, lang);
    syncLangToggle();
    applyI18n();
  };

  const syncLangToggle = () => {
    const zhBtn = byId("lang-zh");
    const enBtn = byId("lang-en");
    if (zhBtn) {
      zhBtn.classList.toggle("is-active", lang === "zh");
      zhBtn.setAttribute("aria-pressed", lang === "zh" ? "true" : "false");
    }
    if (enBtn) {
      enBtn.classList.toggle("is-active", lang === "en");
      enBtn.setAttribute("aria-pressed", lang === "en" ? "true" : "false");
    }
  };

  const setupLangToggle = () => {
    const zhBtn = byId("lang-zh");
    const enBtn = byId("lang-en");
    if (zhBtn) zhBtn.addEventListener("click", () => setLang("zh"));
    if (enBtn) enBtn.addEventListener("click", () => setLang("en"));
    syncLangToggle();
  };

  const toggleHidden = (el, hidden) => {
    if (!el) return;
    el.classList.toggle("is-hidden", Boolean(hidden));
  };

  const setStatusText = (el, text, kind) => {
    if (!el) return;
    el.textContent = safeText(text);
    el.classList.remove("is-error", "is-warn", "is-ok");
    if (kind === "error") el.classList.add("is-error");
    if (kind === "warn") el.classList.add("is-warn");
    if (kind === "ok") el.classList.add("is-ok");
  };

  const apiFetch = async (path, init = {}) => {
    const headers = new Headers(init.headers || {});
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    const wantsJsonBody = init.body != null && typeof init.body === "string" && !headers.has("Content-Type");
    if (wantsJsonBody) headers.set("Content-Type", "application/json");

    const resp = await fetch(path, { ...init, headers, credentials: "include" });
    if (resp.ok) return resp;

    let detail = "";
    const ct = safeText(resp.headers.get("content-type")).toLowerCase();
    try {
      if (ct.includes("application/json")) {
        const data = await resp.json();
        detail = safeText(data?.detail || data?.message || data?.error || "");
      } else {
        detail = (await resp.text()).trim();
      }
    } catch {
      detail = "";
    }

    const err = new Error(`HTTP ${resp.status}`);
    err.status = resp.status;
    err.detail = detail;
    throw err;
  };

  const fetchMe = async () => {
    const resp = await apiFetch("/api/auth/me", { method: "GET" });
    const data = await resp.json().catch(() => null);
    return data && typeof data === "object" ? data : null;
  };

  const redirectToLogin = () => {
    window.location.assign("/login");
  };

  const initLoginPage = () => {
    const form = byId("login-form");
    if (!form) return;

    const emailEl = byId("login-email");
    const passEl = byId("login-password");
    const msgEl = byId("login-message");
    const registerBtn = byId("register-btn");
    const loginBtn = byId("login-btn");

    const setMsg = (text, kind) => setStatusText(msgEl, text, kind);

    const withBusy = async (fn) => {
      if (loginBtn) loginBtn.disabled = true;
      if (registerBtn) registerBtn.disabled = true;
      try {
        return await fn();
      } finally {
        if (loginBtn) loginBtn.disabled = false;
        if (registerBtn) registerBtn.disabled = false;
      }
    };

    const doLogin = async () => {
      const email = safeText(emailEl?.value).trim();
      const password = safeText(passEl?.value);
      if (!email || !password) {
        setMsg(t("login.msg.emailRequired"), "error");
        return;
      }

      setMsg(t("login.msg.loggingIn"), "warn");
      await withBusy(async () => {
        await apiFetch("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password })
        });
      });
      window.location.assign("/");
    };

    const doRegister = async () => {
      const email = safeText(emailEl?.value).trim();
      const password = safeText(passEl?.value);
      if (!email || !password) {
        setMsg(t("login.msg.emailRequired"), "error");
        return;
      }

      setMsg(t("login.msg.registering"), "warn");
      await withBusy(async () => {
        await apiFetch("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({ email, password })
        });
      });
      window.location.assign("/");
    };

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      void doLogin().catch((err) => {
        const status = err && typeof err === "object" ? err.status : null;
        const detail = err && typeof err === "object" ? err.detail : "";
        const suffix = safeText(detail).trim();
        setMsg(`${t("login.msg.loginFailed")} (${status || "error"}). ${suffix}`.trim(), "error");
      });
    });

    if (registerBtn) {
      registerBtn.addEventListener("click", (e) => {
        e.preventDefault();
        void doRegister().catch((err) => {
          const status = err && typeof err === "object" ? err.status : null;
          const detail = err && typeof err === "object" ? err.detail : "";
          const suffix = safeText(detail).trim();
          setMsg(`${t("login.msg.registerFailed")} (${status || "error"}). ${suffix}`.trim(), "error");
        });
      });
    }

    setMsg(t("login.msg.sessionCheck"), "warn");
    void fetchMe()
      .then((me) => {
        if (me) window.location.assign("/");
      })
      .catch(() => {
        setMsg("", null);
      });
  };

  const initCockpitPage = () => {
    const runPanel = byId("run-panel");
    if (!runPanel) return;

    const ui = {
      cockpitView: byId("cockpit-view"),
      logoutBtn: byId("logout-btn"),
      sessionLabel: byId("session-label"),
      inputNl: byId("run-input-nl"),
      runId: byId("run-id"),
      createForm: byId("run-create-form"),
      connectBtn: byId("run-connect"),
      disconnectBtn: byId("run-disconnect"),
      message: byId("run-message"),
      connPill: byId("run-connection-pill"),
      eventList: byId("event-log-list"),
      eventsClear: byId("events-clear"),
      agentTree: byId("agent-tree"),
      agentMeta: byId("agent-meta"),
      sopAgent: byId("sop-agent"),
      sopVersion: byId("sop-version"),
      sopExpected: byId("sop-expected-version"),
      sopDisplay: byId("sop-display"),
      sopEditor: byId("sop-editor"),
      sopForm: byId("sop-replace-form")
    };

    const disclosures = {
      agent: byId("agent-details"),
      sopDisplay: byId("sop-display-details"),
      sopReplace: byId("sop-replace-details"),
      events: byId("event-log-details")
    };

    const state = {
      runId: "",
      ws: null,
      events: [],
      agents: [],
      edges: [],
      selectedAgentId: null,
      session: null,
      sop: {
        mdText: "",
        version: null,
        expectedVersion: null,
        editorDirty: false
      }
    };

    let sopReplaceUnlockedOnce = false;

    const isDesktop = () => window.matchMedia?.("(min-width: 920px)")?.matches === true;

    const setDetailsOpen = (el, open) => {
      if (!el || typeof el.open !== "boolean") return;
      el.open = Boolean(open);
    };

    const applyDisclosureDefaults = () => {
      const desktop = isDesktop();
      setDetailsOpen(disclosures.agent, desktop);
      setDetailsOpen(disclosures.sopDisplay, desktop);
      setDetailsOpen(disclosures.events, desktop);
    };

    const setSopReplaceLocked = (locked, opts = {}) => {
      const el = disclosures.sopReplace;
      if (!el) return;

      const shouldLock = Boolean(locked);
      el.dataset.locked = shouldLock ? "true" : "false";
      if (shouldLock) {
        el.open = false;
      } else if (opts.autoOpen && !sopReplaceUnlockedOnce) {
        el.open = true;
        sopReplaceUnlockedOnce = true;
      }

      if (ui.sopEditor) ui.sopEditor.disabled = shouldLock;
      const sopSubmit = byId("sop-submit");
      if (sopSubmit) sopSubmit.disabled = shouldLock;
    };

    const setSessionUi = (session) => {
      const user = session && typeof session === "object" ? session.user : null;
      const tenant = session && typeof session === "object" ? session.tenant : null;
      const email = safeText(user?.email || user?.username || "").trim();
      const tenantName = safeText(tenant?.name || "").trim();
      const label = email ? `${email}${tenantName ? ` @ ${tenantName}` : ""}` : session ? "Signed in" : "";

      if (ui.sessionLabel) ui.sessionLabel.textContent = label;
      toggleHidden(ui.sessionLabel, !session);
      toggleHidden(ui.logoutBtn, !session);
    };

    const setMessage = (text, kind) => setStatusText(ui.message, text, kind);

    const setPill = (status) => {
      const pill = ui.connPill;
      if (!pill) return;
      const s = safeText(status).trim().toLowerCase();
      const key = s ? `run.status.${s}` : "run.status.idle";
      pill.textContent = t(key);
      pill.classList.remove("success", "error", "warning", "neutral");
      const cls =
        s === "connected"
          ? "success"
          : s === "connecting"
            ? "neutral"
            : s === "closed"
              ? "warning"
              : s === "error"
                ? "error"
                : "neutral";
      pill.classList.add(cls);
    };

    const setConnectionStatus = (status) => {
      setPill(status);
    };

    const nowStamp = () => {
      const d = new Date();
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      const ss = String(d.getSeconds()).padStart(2, "0");
      return `${hh}:${mm}:${ss}`;
    };

    const formatEventLine = (frame) => {
      if (typeof frame === "string") return frame;
      if (!frame || typeof frame !== "object") return safeText(frame);

      const type = frame.type || frame.event_type || frame.kind || frame.name;
      const data = frame.data != null ? frame.data : frame;
      let body = "";
      try {
        body = typeof data === "string" ? data : JSON.stringify(data);
      } catch {
        body = "[unserializable event]";
      }
      return type ? `${type}: ${body}` : body;
    };

    const appendEvent = (frame, opts = {}) => {
      if (!ui.eventList) return;
      const line = formatEventLine(frame);
      const item = document.createElement("li");
      item.textContent = `[${nowStamp()}] ${line}`;
      ui.eventList.appendChild(item);
      if (opts.limit && ui.eventList.childElementCount > opts.limit) {
        while (ui.eventList.childElementCount > opts.limit) {
          ui.eventList.removeChild(ui.eventList.firstElementChild);
        }
      }
      ui.eventList.scrollTop = ui.eventList.scrollHeight;
    };

    const clearEvents = (opts = {}) => {
      const resetState = opts.resetState !== false;
      if (resetState) state.events = [];
      if (ui.eventList) ui.eventList.innerHTML = "";
    };

    const getRunId = () => (ui.runId ? ui.runId.value.trim() : "");

    const wsUrlForRun = (runId) => {
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      const host = window.location.host;
      return `${scheme}://${host}/ws/runs/${encodeURIComponent(runId)}`;
    };

    const disconnectWs = () => {
      if (state.ws) {
        try {
          state.ws.close();
        } catch {
        }
      }
      state.ws = null;
      setConnectionStatus("closed");
    };

    const handleAuthError = (err) => {
      const status = err && typeof err === "object" ? err.status : null;
      if (status !== 401 && status !== 403) return false;
      redirectToLogin();
      return true;
    };

    const applySnapshot = (data) => {
      const snap = data && typeof data === "object" ? data : {};
      const agents = Array.isArray(snap.agents) ? snap.agents : [];
      const edges = Array.isArray(snap.edges) ? snap.edges : [];
      const events = Array.isArray(snap.events) ? snap.events : [];

      clearEvents({ resetState: false });

      state.agents = agents;
      state.edges = edges;
      state.events = events;

      renderAgentTree();
      events.forEach((evt) => {
        appendEvent(evt, { limit: 240 });
      });

      if (!state.selectedAgentId && agents.length) {
        const first = agents[0] && agents[0].id != null ? String(agents[0].id) : null;
        if (first) {
          void selectAgent(first);
        }
      }
    };

    const handleWsMessage = (raw) => {
      let frame = raw;
      try {
        frame = JSON.parse(raw);
      } catch {
        appendEvent(String(raw), { limit: 240 });
        return;
      }

      if (!frame || typeof frame !== "object") {
        appendEvent(frame, { limit: 240 });
        return;
      }

      if (frame.type === "snapshot") {
        applySnapshot(frame.data);
        appendEvent(
          { type: "snapshot", data: { agents: state.agents.length, edges: state.edges.length, events: state.events.length } },
          { limit: 240 }
        );
        return;
      }

      appendEvent(frame, { limit: 240 });
    };

    const connectWs = () => {
      const runId = getRunId();
      if (!state.session) {
        redirectToLogin();
        return;
      }
      if (!runId) {
        setMessage(t("run.msg.missingRunId"), "error");
        return;
      }

      state.runId = runId;
      localStorage.setItem(STORAGE.runId, runId);

      if (state.ws) disconnectWs();

      const url = wsUrlForRun(runId);
      setConnectionStatus("connecting");
      setMessage(`${t("run.msg.connectingTo")} ${runId}...`, "warn");
      clearEvents();
      appendEvent(`WS /ws/runs/${runId}`);

      const ws = new WebSocket(url);
      state.ws = ws;

      ws.addEventListener("open", () => {
        if (state.ws !== ws) return;
        setConnectionStatus("connected");
        setMessage(t("run.msg.connected"), "ok");
      });

      ws.addEventListener("message", (event) => {
        if (state.ws !== ws) return;
        handleWsMessage(event.data);
      });

      ws.addEventListener("close", () => {
        if (state.ws !== ws) return;
        setConnectionStatus("closed");
        setMessage(t("run.msg.disconnected"), "warn");
        state.ws = null;
      });

      ws.addEventListener("error", () => {
        if (state.ws !== ws) return;
        setConnectionStatus("error");
        setMessage(t("run.msg.wsError"), "error");
      });
    };

    const createRun = async () => {
      const inputNl = ui.inputNl ? ui.inputNl.value.trim() : "";
      if (!state.session) {
        redirectToLogin();
        return;
      }
      if (!inputNl) {
        setMessage(t("run.msg.createMissingInput"), "error");
        return;
      }

      setMessage(t("run.msg.creating"), "warn");
      try {
        const resp = await apiFetch("/api/runs", {
          method: "POST",
          body: JSON.stringify({ input_nl: inputNl, input: {} })
        });
        const data = await resp.json().catch(() => null);
        const runId = safeText(data?.run_id || data?.id).trim();
        if (!runId) {
          setMessage(t("run.msg.createMissingId"), "error");
          return;
        }
        if (ui.runId) ui.runId.value = runId;
        if (ui.inputNl) localStorage.setItem(STORAGE.inputNl, ui.inputNl.value.trim());
        setMessage(`${t("run.msg.runCreated")}: ${runId}`, "ok");
        connectWs();
      } catch (err) {
        if (handleAuthError(err)) return;
        const status = err && typeof err === "object" ? err.status : null;
        const detail = err && typeof err === "object" ? err.detail : "";
        setMessage(`Create run failed (${status || "error"}). ${safeText(detail)}`.trim(), "error");
      }
    };

    const labelForAgent = (agent, agentId) => {
      if (!agent || typeof agent !== "object") return agentId;
      const name = agent.name || agent.label || agent.title;
      const kind = agent.type || agent.agent_type;
      const suffix = kind ? ` (${kind})` : "";
      return `${safeText(name || agentId)}${suffix}`;
    };

    const getEdgePair = (edge) => {
      if (!edge) return [null, null];
      if (Array.isArray(edge) && edge.length >= 2) return [edge[0], edge[1]];
      if (typeof edge === "object") {
        const from = edge.from ?? edge.source ?? edge.parent ?? edge.u ?? edge.a;
        const to = edge.to ?? edge.target ?? edge.child ?? edge.v ?? edge.b;
        return [from, to];
      }
      return [null, null];
    };

    const formatAgentsCount = (n) => {
      const count = Number.isFinite(n) ? n : 0;
      const word = count === 1 ? t("agents.count.one") : t("agents.count.many");
      return `${count} ${word}`;
    };

    const renderAgentTree = () => {
      if (!ui.agentTree) return;
      ui.agentTree.innerHTML = "";

      const agents = Array.isArray(state.agents) ? state.agents : [];
      const edges = Array.isArray(state.edges) ? state.edges : [];

      if (ui.agentMeta) ui.agentMeta.textContent = formatAgentsCount(agents.length);

      const nodesById = new Map();
      agents.forEach((agent) => {
        const id = agent && agent.id != null ? String(agent.id) : null;
        if (!id) return;
        nodesById.set(id, agent);
      });

      if (!nodesById.size) {
        const li = document.createElement("li");
        li.className = "agent-tree-empty";
        li.textContent = t("agents.empty");
        ui.agentTree.appendChild(li);
        return;
      }

      const childrenByParent = new Map();
      const parentCount = new Map();
      edges.forEach((edge) => {
        const [rawFrom, rawTo] = getEdgePair(edge);
        if (rawFrom == null || rawTo == null) return;
        const from = String(rawFrom);
        const to = String(rawTo);
        if (!from || !to) return;

        if (!childrenByParent.has(from)) childrenByParent.set(from, new Set());
        childrenByParent.get(from).add(to);
        parentCount.set(to, (parentCount.get(to) || 0) + 1);
      });

      const allIds = Array.from(nodesById.keys());
      const roots = allIds.filter((id) => !parentCount.has(id));
      const order = roots.length ? roots : allIds;

      const rendered = new Set();
      const renderNode = (id, depth, path) => {
        if (rendered.has(id)) return;
        rendered.add(id);

        const li = document.createElement("li");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "agent-node";
        if (state.selectedAgentId === id) btn.classList.add("is-selected");
        btn.dataset.agentId = id;
        btn.style.paddingLeft = `${10 + depth * 14}px`;
        btn.textContent = labelForAgent(nodesById.get(id), id);

        li.appendChild(btn);
        ui.agentTree.appendChild(li);

        if (path.has(id)) return;
        const nextPath = new Set(path);
        nextPath.add(id);
        const kids = childrenByParent.get(id);
        if (!kids || !kids.size) return;
        Array.from(kids).forEach((childId) => {
          if (!nodesById.has(childId)) return;
          renderNode(childId, depth + 1, nextPath);
        });
      };

      order.forEach((id) => {
        renderNode(id, 0, new Set());
      });
      allIds.forEach((id) => {
        renderNode(id, 0, new Set());
      });
    };

    const updateSopUi = () => {
      if (ui.sopAgent) {
        const id = state.selectedAgentId;
        if (!id) {
          ui.sopAgent.textContent = t("sop.noAgent");
        } else {
          const agent = Array.isArray(state.agents)
            ? state.agents.find((entry) => entry && entry.id != null && String(entry.id) === id)
            : null;
          ui.sopAgent.textContent = agent ? labelForAgent(agent, id) : id;
        }
      }
      if (ui.sopVersion) ui.sopVersion.textContent = state.sop.version != null ? `v${state.sop.version}` : "v-";
      if (ui.sopExpected) ui.sopExpected.textContent = state.sop.expectedVersion != null ? safeText(state.sop.expectedVersion) : "-";
      if (ui.sopDisplay) ui.sopDisplay.textContent = state.sop.mdText || "";
    };

    const fetchSop = async (agentId) => {
      if (!agentId) return;
      if (!state.session) {
        redirectToLogin();
        return;
      }

      setMessage(`${t("sop.msg.fetching")} ${agentId}...`, "warn");
      try {
        const resp = await apiFetch(`/api/agents/${encodeURIComponent(agentId)}/sop`, { method: "GET" });
        const ct = safeText(resp.headers.get("content-type")).toLowerCase();
        let mdText = "";
        let version = null;
        if (ct.includes("application/json")) {
          const data = await resp.json().catch(() => null);
          mdText = safeText(data?.md_text ?? data?.mdText ?? data?.markdown ?? data?.text ?? data?.sop ?? "");
          version = data?.version ?? data?.expected_version ?? data?.rev ?? data?.revision ?? null;
        } else {
          mdText = await resp.text();
        }

        state.sop.mdText = mdText;
        state.sop.version = version;
        state.sop.expectedVersion = version;
        updateSopUi();

        if (ui.sopEditor && !state.sop.editorDirty) ui.sopEditor.value = mdText;
        setMessage(t("sop.msg.loaded"), "ok");
      } catch (err) {
        if (handleAuthError(err)) return;
        const status = err && typeof err === "object" ? err.status : null;
        const detail = err && typeof err === "object" ? err.detail : "";
        setMessage(`${t("sop.msg.fetchFailed")} (${status || "error"}). ${safeText(detail)}`.trim(), "error");
      }
    };

    const selectAgent = async (agentId) => {
      state.selectedAgentId = agentId;
      state.sop.editorDirty = false;
      renderAgentTree();
      updateSopUi();
      setSopReplaceLocked(!state.selectedAgentId, { autoOpen: isDesktop() });
      await fetchSop(agentId);
    };

    const submitSopReplace = async () => {
      const runId = getRunId();
      const agentId = state.selectedAgentId;
      const mdText = ui.sopEditor ? ui.sopEditor.value : "";
      const expectedVersion = state.sop.expectedVersion;

      if (!state.session) {
        redirectToLogin();
        return;
      }
      if (!runId) {
        setMessage(t("sop.msg.needRun"), "error");
        return;
      }
      if (!agentId) {
        setMessage(t("sop.msg.needAgent"), "error");
        return;
      }
      if (!mdText.trim()) {
        setMessage(t("sop.msg.missingMd"), "error");
        return;
      }
      if (expectedVersion == null) {
        setMessage(t("sop.msg.missingExpected"), "error");
        return;
      }

      const idempotencyKey =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `idemp_${Date.now()}_${Math.random().toString(16).slice(2)}`;

      setMessage(t("sop.msg.replaceSubmitting"), "warn");
      try {
        await apiFetch(`/api/runs/${encodeURIComponent(runId)}/actions`, {
          method: "POST",
          body: JSON.stringify({
            target_agent_id: agentId,
            action_type: "sop.replace",
            expected_version: expectedVersion,
            md_text: mdText,
            idempotency_key: idempotencyKey
          })
        });

        state.sop.editorDirty = false;
        setMessage(t("sop.msg.replaceSubmitted"), "ok");
        await fetchSop(agentId);
        state.sop.expectedVersion = state.sop.version;
        updateSopUi();
      } catch (err) {
        if (handleAuthError(err)) return;
        const status = err && typeof err === "object" ? err.status : null;
        const detail = err && typeof err === "object" ? err.detail : "";
        setMessage(`${t("sop.msg.replaceFailed")} (${status || "error"}). ${safeText(detail)}`.trim(), "error");
      }
    };

    const logout = async () => {
      if (!state.session) {
        redirectToLogin();
        return;
      }
      setMessage(t("logout.msg.loggingOut"), "warn");
      try {
        await apiFetch("/api/auth/logout", { method: "POST" });
      } catch {
      }
      disconnectWs();
      clearEvents();
      state.session = null;
      setSessionUi(null);
      redirectToLogin();
    };

    const bootstrapAuth = async () => {
      try {
        const me = await fetchMe();
        state.session = me;
        setSessionUi(me);
        applyDisclosureDefaults();
        setSopReplaceLocked(true);
        updateSopUi();
        setConnectionStatus("idle");
        setMessage(t("run.msg.createRunHint"));
      } catch (err) {
        const status = err && typeof err === "object" ? err.status : null;
        if (status === 401 || status === 403) {
          redirectToLogin();
        } else {
          setMessage("Unable to reach /api/auth/me.", "error");
        }
      }
    };

    if (window.matchMedia) {
      const mq = window.matchMedia("(min-width: 920px)");
      if (typeof mq.addEventListener === "function") {
        mq.addEventListener("change", () => applyDisclosureDefaults());
      } else if (typeof mq.addListener === "function") {
        mq.addListener(() => applyDisclosureDefaults());
      }
    }

    if (ui.inputNl) {
      const stored = localStorage.getItem(STORAGE.inputNl);
      if (stored) ui.inputNl.value = stored;
      ui.inputNl.addEventListener("change", () => {
        localStorage.setItem(STORAGE.inputNl, ui.inputNl.value.trim());
      });
    }

    if (ui.runId) {
      const stored = localStorage.getItem(STORAGE.runId);
      if (stored) ui.runId.value = stored;
      ui.runId.addEventListener("change", () => {
        localStorage.setItem(STORAGE.runId, getRunId());
      });
    }

    if (ui.createForm) {
      ui.createForm.addEventListener("submit", (e) => {
        e.preventDefault();
        void createRun();
      });
    }

    if (ui.connectBtn) {
      ui.connectBtn.addEventListener("click", (e) => {
        e.preventDefault();
        connectWs();
      });
    }

    if (ui.disconnectBtn) {
      ui.disconnectBtn.addEventListener("click", (e) => {
        e.preventDefault();
        disconnectWs();
        setMessage(t("run.msg.disconnectOk"), "warn");
      });
    }

    if (ui.eventsClear) {
      ui.eventsClear.addEventListener("click", (e) => {
        e.preventDefault();
        clearEvents();
        appendEvent(t("run.msg.cleared"));
      });
    }

    if (ui.agentTree) {
      ui.agentTree.addEventListener("click", (e) => {
        const target = e.target;
        const btn = target?.closest?.("button[data-agent-id]");
        if (!btn) return;
        const id = safeText(btn.dataset.agentId).trim();
        if (!id) return;
        void selectAgent(id);
      });
    }

    if (ui.sopEditor) {
      ui.sopEditor.addEventListener("input", () => {
        state.sop.editorDirty = true;
      });
    }

    if (ui.sopForm) {
      ui.sopForm.addEventListener("submit", (e) => {
        e.preventDefault();
        void submitSopReplace();
      });
    }

    if (disclosures.sopReplace) {
      disclosures.sopReplace.addEventListener("toggle", () => {
        if (disclosures.sopReplace.dataset.locked === "true" && disclosures.sopReplace.open) {
          disclosures.sopReplace.open = false;
          setMessage(t("sop.msg.selectAgent"), "warn");
        }
      });
    }

    if (ui.logoutBtn) {
      ui.logoutBtn.addEventListener("click", (e) => {
        e.preventDefault();
        void logout();
      });
    }

    void bootstrapAuth();
    window.addEventListener("beforeunload", () => disconnectWs());
  };

  setupLangToggle();
  applyI18n();
  initLoginPage();
  initCockpitPage();
})();
