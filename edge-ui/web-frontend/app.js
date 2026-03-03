(() => {
  const byId = (id) => document.getElementById(id);
  const safeText = (value) => (value == null ? "" : String(value));

  const STORAGE = {
    runId: "roboard_run_id",
    inputNl: "roboard_run_input_nl",
    lang: "roboard_lang",
    sessionToken: "roboard_session_token"
  };

  const STRINGS = {
    en: {
      "login.pageTitle": "RoBoard Login",
      "login.kicker": "Task Tree access",
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

      "logout.msg.loggingOut": "Logging out...",

      "taskTree.pageTitle": "RoBoard Task Tree",
      "taskTree.logout": "Logout",
      "taskTree.title": "Task Tree",
      "templates.nav": "Templates",
      "agentRecruit.nav": "Agent Recruit",
      "taskTree.kanban.title": "Task Board",
      "taskTree.kanban.todo": "To Do",
      "taskTree.kanban.running": "Running",
      "taskTree.kanban.done": "Done",
      "taskTree.kanban.blocked": "Blocked",
      "taskTree.state.todo": "To Do",
      "taskTree.state.running": "Running",
      "taskTree.state.done": "Done",
      "taskTree.state.blocked": "Blocked",
      "taskTree.statusIdle": "Idle",
      "taskTree.statusConnecting": "Connecting",
      "taskTree.statusConnected": "Connected",
      "taskTree.statusClosed": "Closed",
      "taskTree.statusError": "Error",
      "taskTree.empty": "No tasks yet. Create a new task to get started.",
      "taskTree.createTask": "Create New Task",
      "taskTree.inputLabel": "Task Description",
      "taskTree.inputPlaceholder": "Describe what you want this task to accomplish...",
      "taskTree.create": "Create Task",
      "taskTree.cancel": "Cancel",
      "taskTree.detailsTitle": "Task Details",
      "taskTree.status": "Status",
      "taskTree.plan": "Plan",
      "taskTree.plan.empty": "No plan subtasks yet.",
      "taskTree.sop": "SOP",
      "taskTree.skills": "Skills",
      "taskTree.skillsEmpty": "No skills yet.",
      "taskTree.skillSearch": "Search",
      "taskTree.skillSearchPlaceholder": "Search skills...",
      "taskTree.skillSearchEmpty": "No results yet.",
      "taskTree.skillNlInstall": "Install by NL",
      "taskTree.skillNlPlaceholder": "Describe the skill you want...",
      "taskTree.skillsAutoHint": "Skills auto-run after install.",
      "taskTree.installSkill": "Install",
      "taskTree.teamTemplate": "Team Template",
      "taskTree.exportYaml": "Export YAML",
      "taskTree.importYaml": "Import YAML",
      "taskTree.importPlaceholder": "Paste team YAML...",
      "taskTree.chat": "Chat",
      "taskTree.chatPlaceholder": "Type a message...",
      "taskTree.send": "Send",
      "taskTree.msg.creating": "Creating task...",
      "taskTree.msg.created": "Task created",
      "taskTree.msg.createFailed": "Create task failed",
      "taskTree.msg.connecting": "Connecting...",
      "taskTree.msg.connected": "Connected",
      "taskTree.msg.disconnected": "Disconnected",
      "taskTree.msg.wsError": "WebSocket error",
      "taskTree.msg.fetchTreeFailed": "Fetch tree failed",
      "taskTree.msg.fetchSopFailed": "Fetch SOP failed",
      "taskTree.msg.skillsLoadFailed": "Load skills failed",
      "taskTree.msg.skillsSearchFailed": "Search failed",
      "taskTree.msg.skillsInstallFailed": "Install skill failed",
      "taskTree.msg.skillsInstallOk": "Skill installed",
      "taskTree.msg.skillsInstallNlFailed": "Install by NL failed",
      "taskTree.msg.skillsInstallNlOk": "Skill installed",

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

      "logout.msg.loggingOut": "正在退出...",

      "taskTree.pageTitle": "RoBoard 任务树",
      "taskTree.logout": "退出",
      "taskTree.title": "任务树",
      "templates.nav": "模板库",
      "agentRecruit.nav": "Agent 招募",
      "taskTree.kanban.title": "任务看板",
      "taskTree.kanban.todo": "待执行",
      "taskTree.kanban.running": "执行中",
      "taskTree.kanban.done": "已完成",
      "taskTree.kanban.blocked": "阻塞",
      "taskTree.state.todo": "待执行",
      "taskTree.state.running": "执行中",
      "taskTree.state.done": "已完成",
      "taskTree.state.blocked": "阻塞",
      "taskTree.statusIdle": "空闲",
      "taskTree.statusConnecting": "连接中",
      "taskTree.statusConnected": "已连接",
      "taskTree.statusClosed": "已断开",
      "taskTree.statusError": "错误",
      "taskTree.empty": "暂无任务。创建新任务以开始。",
      "taskTree.createTask": "创建新任务",
      "taskTree.inputLabel": "任务描述",
      "taskTree.inputPlaceholder": "描述这个任务要完成什么...",
      "taskTree.create": "创建任务",
      "taskTree.cancel": "取消",
      "taskTree.detailsTitle": "任务详情",
      "taskTree.status": "状态",
      "taskTree.plan": "计划",
      "taskTree.plan.empty": "暂无计划子任务。",
      "taskTree.sop": "SOP",
      "taskTree.skills": "技能",
      "taskTree.skillsEmpty": "暂无技能。",
      "taskTree.skillSearch": "Search",
      "taskTree.skillSearchPlaceholder": "Search skills...",
      "taskTree.skillSearchEmpty": "No results yet.",
      "taskTree.skillNlInstall": "Install by NL",
      "taskTree.skillNlPlaceholder": "Describe the skill you want...",
      "taskTree.skillsAutoHint": "Skills auto-run after install.",
      "taskTree.installSkill": "安装",
      "taskTree.teamTemplate": "团队模板",
      "taskTree.exportYaml": "导出 YAML",
      "taskTree.importYaml": "导入 YAML",
      "taskTree.importPlaceholder": "粘贴团队 YAML...",
      "taskTree.chat": "聊天",
      "taskTree.chatPlaceholder": "输入消息...",
      "taskTree.send": "发送",
      "taskTree.msg.creating": "正在创建任务...",
      "taskTree.msg.created": "任务已创建",
      "taskTree.msg.createFailed": "创建任务失败",
      "taskTree.msg.connecting": "连接中...",
      "taskTree.msg.connected": "已连接",
      "taskTree.msg.disconnected": "已断开",
      "taskTree.msg.wsError": "WebSocket 错误",
      "taskTree.msg.fetchTreeFailed": "获取树失败",
      "taskTree.msg.fetchSopFailed": "获取 SOP 失败",
      "taskTree.msg.skillsLoadFailed": "加载技能失败",
      "taskTree.msg.skillsSearchFailed": "Search failed",
      "taskTree.msg.skillsInstallFailed": "安装技能失败",
      "taskTree.msg.skillsInstallOk": "技能已安装",
      "taskTree.msg.skillsInstallNlFailed": "Install by NL failed",
      "taskTree.msg.skillsInstallNlOk": "技能已安装",

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
    document.title = isLogin ? t("login.pageTitle") : t("taskTree.pageTitle");

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
    if (window.taskTreeRefreshKanbanLabels) window.taskTreeRefreshKanbanLabels();
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

    // Add session token header if available (for chat endpoint auth)
    const sessionToken = localStorage.getItem(STORAGE.sessionToken);
    if (sessionToken && !headers.has("X-Session-Token")) {
      headers.set("X-Session-Token", sessionToken);
    }

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
        const resp = await apiFetch("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password })
        });
        const data = await resp.json().catch(() => null);
        if (data && typeof data === "object" && typeof data.session_token === "string" && data.session_token) {
          localStorage.setItem(STORAGE.sessionToken, data.session_token);
        } else {
          throw new Error("Invalid response: missing session_token");
        }
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
        const resp = await apiFetch("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({ email, password })
        });
        const data = await resp.json().catch(() => null);
        if (data && typeof data === "object" && typeof data.session_token === "string" && data.session_token) {
          localStorage.setItem(STORAGE.sessionToken, data.session_token);
        } else {
          throw new Error("Invalid response: missing session_token");
        }
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

  const initRunConsolePage = () => {
    const runPanel = byId("run-panel");
    if (!runPanel) return;

    const ui = {
      runConsoleView: byId("run-console-view"),
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

      viewState.sessionLabel = label;
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
      const sessionToken = localStorage.getItem(STORAGE.sessionToken);
      const query = sessionToken ? `?session_token=${encodeURIComponent(sessionToken)}` : "";
      return `${scheme}://${host}/ws/runs/${encodeURIComponent(runId)}${query}`;
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

    // Manual QA checklist:
    // 1) Create/connect a run and verify agent tree shows name/state/current_step.
    // 2) Select an agent and confirm plan subtasks list renders with statuses.

    void bootstrapAuth();
    window.addEventListener("beforeunload", () => disconnectWs());
  };

  const initTaskTreePage = () => {
    const addTaskBtn = byId("add-task-btn");
    if (!addTaskBtn) return;

    const viewState = window.Alpine?.reactive
      ? window.Alpine.reactive({
        activeView: "tree",
        treeNodes: [],
        logItems: [],
        kanbanColumns: [],
        kanbanHasItems: false,
        selectedNodeId: null,
        sessionLabel: ""
      })
      : {
        activeView: "tree",
        treeNodes: [],
        logItems: [],
        kanbanColumns: [],
        kanbanHasItems: false,
        selectedNodeId: null,
        sessionLabel: ""
      };

    const ui = {
      logoutBtn: byId("logout-btn"),
      sessionLabel: byId("session-label"),
      userDropdownTrigger: byId("user-dropdown-trigger"),
      userDropdownMenu: byId("user-dropdown-menu"),
      modal: byId("add-task-modal"),
      overlay: byId("add-task-modal")?.querySelector(".modal-overlay"),
      closeModalBtn: byId("close-modal-btn"),
      cancelTaskBtn: byId("cancel-task-btn"),
      addTaskForm: byId("add-task-form"),
      taskInputNl: byId("task-input-nl"),
      taskConnectionPill: byId("task-connection-pill"),
      taskMessage: byId("task-message"),
      taskViewTreeTab: byId("task-view-tree-tab"),
      taskViewLogTab: byId("task-view-log-tab"),
      taskViewKanbanTab: byId("task-view-kanban-tab"),
      taskTreeSection: byId("task-tree-section"),
      taskLogSection: byId("task-log-section"),
      taskKanbanSection: byId("task-kanban-section"),
      taskLogList: byId("task-log-list"),
      taskLogEmpty: byId("task-log-empty"),
      taskKanbanTodo: byId("task-kanban-todo"),
      taskKanbanRunning: byId("task-kanban-running"),
      taskKanbanDone: byId("task-kanban-done"),
      taskKanbanBlocked: byId("task-kanban-blocked"),
      taskKanbanEmpty: byId("task-kanban-empty"),
      taskTreeRoot: byId("task-tree-root"),
      taskDetailsSection: byId("task-details-section"),
      taskDetailsTitle: byId("task-details-title"),
      closeDetailsBtn: byId("close-details-btn"),
      taskSummaryDisplay: byId("task-summary-display"),
      taskDetailsOverlay: byId("task-details-section")?.querySelector(".modal-overlay"),
      taskStatusDisplay: byId("task-status-display"),
      taskPlanList: byId("task-plan-list"),
      taskPlanEmpty: byId("task-plan-empty"),
      taskSopDisplay: byId("task-sop-display"),
      taskSkillsList: byId("task-skills-list"),
      taskSkillsEmpty: byId("task-skills-empty"),
      taskSkillSearchForm: byId("task-skill-search-form"),
      taskSkillSearchInput: byId("task-skill-search-input"),
      taskSkillSearchResults: byId("task-skill-search-results"),
      taskSkillSearchEmpty: byId("task-skill-search-empty"),
      taskSkillNlForm: byId("task-skill-install-nl-form"),
      taskSkillNlInput: byId("task-skill-nl-input"),
      taskSkillInstallNl: byId("task-skill-install-nl"),
      taskSkillSelect: byId("task-skill-select"),
      taskSkillInstall: byId("task-skill-install"),
      taskChatMessages: byId("task-chat-messages"),
      taskChatForm: byId("task-chat-form"),
      taskChatInput: byId("task-chat-input")
    };

    const state = {
      session: null,
      ws: null,
      runId: "",
      selectedNode: null,
      chatHistories: {},
      skillsByAgent: {},
      communitySkills: [],
      communitySearchResults: [],
      communitySearchQuery: "",
      dragPayload: null,
      pointerDrag: null,
      suppressNextClick: false,
      deltaFetchTimer: null,
      activeView: "tree",
      recentEvents: [],
      logSeq: 0
    };

    window.taskTreeState = viewState;
    viewState.init = () => {
      viewState.activeView = state.activeView;
      viewState.dotClass = dotClassForStatus;
      viewState.setActiveView = setActiveView;
      viewState.selectNode = viewState.selectNode || (() => {});
      if (state.session) setSessionUi(state.session);
      refreshKanbanLabels();
    };

    const dotClassForStatus = (value) => {
      const key = safeText(value).toLowerCase().trim();
      if (key === "completed" || key === "done" || key === "success") return "dot-done";
      if (key === "running" || key === "in_progress" || key === "working") return "dot-running";
      return "dot-wait";
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
      toggleHidden(addTaskBtn, !session);
      updateMobileControlsState();
    };

    const setMessage = (text, kind) => setStatusText(ui.taskMessage, text, kind);

    const viewMap = {
      tree: { tab: ui.taskViewTreeTab, panel: ui.taskTreeSection },
      log: { tab: ui.taskViewLogTab, panel: ui.taskLogSection },
      kanban: { tab: ui.taskViewKanbanTab, panel: ui.taskKanbanSection }
    };

    const setActiveView = (view) => {
      const next = safeText(view).trim().toLowerCase();
      const target = viewMap[next] ? next : "tree";
      state.activeView = target;
      viewState.activeView = target;

      if (!window.Alpine) {
        Object.entries(viewMap).forEach(([key, entry]) => {
          if (entry.panel) entry.panel.classList.toggle("is-hidden", key !== target);
          if (entry.tab) {
            entry.tab.classList.toggle("is-active", key === target);
            entry.tab.setAttribute("aria-selected", key === target ? "true" : "false");
          }
        });
      }
    };

    viewState.setActiveView = setActiveView;
    viewState.dotClass = dotClassForStatus;

    const setupViewTabs = () => {
      if (!window.Alpine) {
        if (ui.taskViewTreeTab) ui.taskViewTreeTab.addEventListener("click", () => setActiveView("tree"));
        if (ui.taskViewLogTab) ui.taskViewLogTab.addEventListener("click", () => setActiveView("log"));
        if (ui.taskViewKanbanTab) ui.taskViewKanbanTab.addEventListener("click", () => setActiveView("kanban"));
      }
      setActiveView(state.activeView);
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

    const setTaskLogEmpty = () => {
      if (window.Alpine) return;
      if (!ui.taskLogEmpty || !ui.taskLogList) return;
      toggleHidden(ui.taskLogEmpty, ui.taskLogList.childElementCount > 0);
    };

    const appendTaskLog = (frame, opts = {}) => {
      const item = {
        id: `${Date.now()}-${state.logSeq++}`,
        time: nowStamp(),
        text: formatEventLine(frame)
      };

      if (window.Alpine) {
        viewState.logItems = [...viewState.logItems, item];
        if (opts.limit && viewState.logItems.length > opts.limit) {
          viewState.logItems = viewState.logItems.slice(-opts.limit);
        }
        return;
      }

      if (!ui.taskLogList) return;
      const li = document.createElement("li");
      li.className = "task-log-item log-item";
      const time = document.createElement("span");
      time.className = "log-time";
      time.textContent = item.time;
      const text = document.createElement("span");
      text.textContent = item.text;
      li.appendChild(time);
      li.appendChild(text);
      ui.taskLogList.appendChild(li);
      if (opts.limit && ui.taskLogList.childElementCount > opts.limit) {
        while (ui.taskLogList.childElementCount > opts.limit) {
          ui.taskLogList.removeChild(ui.taskLogList.firstElementChild);
        }
      }
      ui.taskLogList.scrollTop = ui.taskLogList.scrollHeight;
      setTaskLogEmpty();
    };

    const clearTaskLog = () => {
      state.recentEvents = [];
      if (window.Alpine) {
        viewState.logItems = [];
        return;
      }
      if (ui.taskLogList) ui.taskLogList.innerHTML = "";
      setTaskLogEmpty();
    };

    const setMobileControlsEnabled = (enabled) => {
      void enabled;
    };

    const updateMobileControlsState = () => {
      const enabled = Boolean(state.session && state.selectedNode && state.runId);
      setMobileControlsEnabled(enabled);
    };

    const setConnectionStatus = (status) => {
      if (!ui.taskConnectionPill) return;
      const s = safeText(status).trim().toLowerCase();
      const key = s ? `taskTree.status${s.charAt(0).toUpperCase() + s.slice(1)}` : "taskTree.statusIdle";
      ui.taskConnectionPill.textContent = t(key);
      ui.taskConnectionPill.classList.remove("success", "error", "warning", "neutral");
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
      ui.taskConnectionPill.classList.add(cls);
    };

    const openModal = () => {
      if (!ui.modal) return;
      ui.modal.classList.remove("is-hidden");
      if (ui.taskInputNl) ui.taskInputNl.focus();
    };

    const closeModal = () => {
      if (!ui.modal) return;
      ui.modal.classList.add("is-hidden");
      if (ui.addTaskForm) ui.addTaskForm.reset();
    };

    const closeDetails = () => {
      if (!ui.taskDetailsSection) return;
      ui.taskDetailsSection.classList.add("is-hidden");
      toggleHidden(addTaskBtn, !state.session);
    };

    const wsUrlForRun = (runId) => {
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      const host = window.location.host;
      const sessionToken = localStorage.getItem(STORAGE.sessionToken);
      const query = sessionToken ? `?session_token=${encodeURIComponent(sessionToken)}` : "";
      return `${scheme}://${host}/ws/runs/${encodeURIComponent(runId)}${query}`;
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

    const createRunWithInput = async (inputNl) => {
      if (!state.session) {
        redirectToLogin();
        return false;
      }
      if (!inputNl) {
        setMessage(t("taskTree.msg.createFailed"), "error");
        return false;
      }

      setMessage(t("taskTree.msg.creating"), "warn");
      try {
        const resp = await apiFetch("/api/runs", {
          method: "POST",
          body: JSON.stringify({ input_nl: inputNl, input: {} })
        });
        const data = await resp.json().catch(() => null);
        const runId = safeText(data?.run_id || data?.id).trim();
        if (!runId) {
          setMessage(t("taskTree.msg.createFailed"), "error");
          return false;
        }
        state.runId = runId;
        localStorage.setItem(STORAGE.runId, runId);
        setMessage(t("taskTree.msg.created"), "ok");
        clearTaskLog();
        renderKanban([]);
        updateMobileControlsState();
        await fetchTree();
        connectWs();
        return true;
      } catch (err) {
        const status = err && typeof err === "object" ? err.status : null;
        const detail = err && typeof err === "object" ? err.detail : "";
        
        
        // For other auth errors, use the existing handler
        if (handleAuthError(err)) return false;
        
        // Generic error message for other cases
        setMessage(`${t("taskTree.msg.createFailed")} (${status || "error"}). ${safeText(detail)}`.trim(), "error");
        updateMobileControlsState();
        return false;
      }
    };

    const createRun = async () => {
      const inputNl = ui.taskInputNl ? ui.taskInputNl.value.trim() : "";
      const success = await createRunWithInput(inputNl);
      if (success) {
        closeModal();
        if (ui.addTaskForm) ui.addTaskForm.reset();
      }
    };

    const connectWs = () => {
      if (!state.session) {
        redirectToLogin();
        return;
      }
      if (!state.runId) {
        setMessage(t("taskTree.msg.createFailed"), "error");
        return;
      }

      disconnectWs();

      const url = wsUrlForRun(state.runId);
      setConnectionStatus("connecting");
      setMessage(t("taskTree.msg.connecting"), "warn");

      let ws;
      try {
        ws = new WebSocket(url);
      } catch {
        setConnectionStatus("error");
        setMessage(t("taskTree.msg.wsError"), "error");
        void fetchTree();
        return;
      }
      state.ws = ws;

      ws.addEventListener("open", () => {
        if (state.ws !== ws) return;
        setConnectionStatus("connected");
        setMessage(t("taskTree.msg.connected"), "ok");
        fetchTree();
      });

      ws.addEventListener("message", (event) => {
        if (state.ws !== ws) return;
        try {
          const frame = JSON.parse(event.data);
          if (!frame || typeof frame !== "object") return;
          
          if (frame.type === "snapshot") {
            renderTree(frame.data);
          } else if (frame.type === "delta" && frame.data) {
            handleDelta(frame.data);
          }
        } catch {
        }
      });

      ws.addEventListener("close", (event) => {
        if (state.ws !== ws) return;
        setConnectionStatus("closed");
        if (event.code === 1008) {
          setMessage("连接被拒绝（会话/租户不匹配或任务不可访问）。已清理历史任务，请创建新任务。", "warn");
        } else {
          setMessage(t("taskTree.msg.disconnected"), "warn");
        }
        state.ws = null;
      });

      ws.addEventListener("error", () => {
        if (state.ws !== ws) return;
        setConnectionStatus("error");
        setMessage(t("taskTree.msg.wsError"), "error");
        void fetchTree();
      });
    };

    const fetchTree = async () => {
      if (!state.runId) return;
      try {
        const resp = await apiFetch(`/api/runs/${encodeURIComponent(state.runId)}/tree`, { method: "GET" });
        const data = await resp.json().catch(() => null);
        renderTree(data);
      } catch (err) {
        if (handleAuthError(err)) return;
        const status = err && typeof err === "object" ? err.status : null;
        if (status === 404) {
          localStorage.removeItem(STORAGE.runId);
          state.runId = "";
          disconnectWs();
        }
        setMessage(t("taskTree.msg.fetchTreeFailed"), "error");
      }
    };

    const labelForAgent = (agent, fallbackId) =>
      safeText(agent?.name || agent?.role_label || agent?.title || agent?.label || fallbackId);

    const stateForAgent = (agent) => safeText(agent?.state || agent?.status || "");

    const stepForAgent = (agent) => safeText(agent?.current_step || agent?.currentStep || "");

    const normalizePlanSubtask = (subtask, index) => {
      if (subtask == null) {
        return { label: `Subtask ${index + 1}`, status: "" };
      }

      if (typeof subtask === "string") {
        return { label: safeText(subtask), status: "" };
      }

      const label = safeText(
        subtask?.text ||
          subtask?.title ||
          subtask?.label ||
          subtask?.name ||
          subtask?.content ||
          subtask?.task ||
          `Subtask ${index + 1}`
      );

      const rawStatus =
        subtask?.status ??
        subtask?.state ??
        subtask?.phase ??
        subtask?.result ??
        (typeof subtask?.checked === "boolean" ? (subtask.checked ? "done" : "todo") : "") ??
        (typeof subtask?.completed === "boolean" ? (subtask.completed ? "done" : "todo") : "") ??
        (typeof subtask?.done === "boolean" ? (subtask.done ? "done" : "todo") : "");

      return { label, status: safeText(rawStatus) };
    };

    const getSubtaskCategory = (status) => {
      const s = safeText(status).toLowerCase().trim();
      if (["done", "completed", "complete", "success", "finished", "checked", "ok"].includes(s)) return "done";
      if (["running", "in_progress", "working", "doing", "active"].includes(s)) return "inProgress";
      if (["needs_human", "blocked", "failed", "error"].includes(s)) return "blocked";
      return "todo";
    };

    const getAgentCategory = (status) => {
      const s = safeText(status).toLowerCase().trim();
      if (["done", "completed", "complete", "success", "finished", "ok"].includes(s)) return "done";
      if (["running", "in_progress", "working", "doing", "active"].includes(s)) return "running";
      if (["needs_human", "blocked", "failed", "error"].includes(s)) return "blocked";
      return "todo";
    };

    const getAgentStatusLabel = (status) => {
      const category = getAgentCategory(status);
      if (category === "running") return t("taskTree.state.running");
      if (category === "done") return t("taskTree.state.done");
      if (category === "blocked") return t("taskTree.state.blocked");
      return t("taskTree.state.todo");
    };

    const renderKanban = (agents) => {
      const list = Array.isArray(agents) ? agents : [];
      const columns = {
        todo: { status: "todo", title: t("taskTree.kanban.todo"), items: [] },
        running: { status: "running", title: t("taskTree.kanban.running"), items: [] },
        done: { status: "done", title: t("taskTree.kanban.done"), items: [] },
        blocked: { status: "blocked", title: t("taskTree.kanban.blocked"), items: [] }
      };

      list.forEach((agent) => {
        const id = agent && agent.id != null ? String(agent.id) : "";
        const label = labelForAgent(agent, id || "-");
        const rawStatus = stateForAgent(agent);
        const category = getAgentCategory(rawStatus);
        const card = { id, label, rawStatus, status: getAgentStatusLabel(rawStatus), agent };
        if (columns[category]) columns[category].items.push(card);
        else columns.todo.items.push(card);
      });

      viewState.kanbanColumns = [columns.todo, columns.running, columns.done, columns.blocked];
      viewState.kanbanHasItems = viewState.kanbanColumns.some((column) => column.items.length > 0);
    };

    const refreshKanbanLabels = () => {
      if (!Array.isArray(viewState.kanbanColumns) || !viewState.kanbanColumns.length) return;
      const labelMap = {
        todo: t("taskTree.kanban.todo"),
        running: t("taskTree.kanban.running"),
        done: t("taskTree.kanban.done"),
        blocked: t("taskTree.kanban.blocked")
      };
      viewState.kanbanColumns = viewState.kanbanColumns.map((column) => ({
        ...column,
        title: labelMap[column.status] || column.title,
        items: column.items.map((item) => ({
          ...item,
          status: getAgentStatusLabel(item.rawStatus)
        }))
      }));
      viewState.kanbanHasItems = viewState.kanbanColumns.some((column) => column.items.length > 0);
    };

    window.taskTreeRefreshKanbanLabels = refreshKanbanLabels;

    const renderPlanSubtasks = (agent) => {
      if (!ui.taskPlanList || !ui.taskPlanEmpty) return;

      ui.taskPlanList.innerHTML = "";
      const subtasks = Array.isArray(agent?.plan_subtasks) ? agent.plan_subtasks : [];

      if (!subtasks.length) {
        ui.taskPlanEmpty.textContent = t("taskTree.plan.empty");
        ui.taskPlanEmpty.classList.remove("is-hidden");
        return;
      }

      ui.taskPlanEmpty.classList.add("is-hidden");

      subtasks.forEach((subtask, index) => {
        const normalized = normalizePlanSubtask(subtask, index);
        const item = document.createElement("li");
        item.className = "plan-item";

        const label = document.createElement("div");
        label.className = "plan-item-title";
        label.textContent = normalized.label;

        const status = document.createElement("div");
        status.className = "plan-item-status";
        status.textContent = normalized.status || "todo";
        status.dataset.status = getSubtaskCategory(normalized.status);

        item.appendChild(label);
        item.appendChild(status);
        ui.taskPlanList.appendChild(item);
      });
    };

    const renderTree = (data) => {
      const agents = Array.isArray(data?.agents) ? data.agents : [];
      const edges = Array.isArray(data?.edges) ? data.edges : [];
      const events = Array.isArray(data?.recent_events)
        ? data.recent_events
        : Array.isArray(data?.events)
          ? data.events
          : [];

      renderKanban(agents);

      if (events.length && !state.recentEvents.length) {
        clearTaskLog();
        events.forEach((evt) => {
          appendTaskLog(evt, { limit: 200 });
        });
        state.recentEvents = events.slice(-200);
      }

      if (!agents.length) {
        viewState.treeNodes = [];
        return;
      }

      const nodesById = new Map();
      agents.forEach((agent) => {
        const id = agent && agent.id != null ? String(agent.id) : null;
        if (!id) return;
        nodesById.set(id, agent);
      });

      const childrenByParent = new Map();
      const parentCount = new Map();
      edges.forEach((edge) => {
        const from = edge?.from ?? edge?.parent ?? edge?.[0];
        const to = edge?.to ?? edge?.child ?? edge?.[1];
        if (from == null || to == null) return;
        const fromStr = String(from);
        const toStr = String(to);
        if (!fromStr || !toStr) return;

        if (!childrenByParent.has(fromStr)) childrenByParent.set(fromStr, new Set());
        childrenByParent.get(fromStr).add(toStr);
        parentCount.set(toStr, (parentCount.get(toStr) || 0) + 1);
      });

      const allIds = Array.from(nodesById.keys());
      const roots = allIds.filter((id) => !parentCount.has(id));
      const order = roots.length ? roots : allIds;

      const rendered = new Set();
      const list = [];
      const renderNode = (id, depth) => {
        if (rendered.has(id)) return;
        rendered.add(id);

        const agent = nodesById.get(id);
        const label = labelForAgent(agent, id);
        const status = stateForAgent(agent);
        const currentStep = stepForAgent(agent);

        list.push({
          id,
          label,
          status,
          currentStep,
          depth,
          agent
        });

        const kids = childrenByParent.get(id);
        if (kids?.size) {
          Array.from(kids).forEach((childId) => {
            if (nodesById.has(childId)) {
              renderNode(childId, depth + 1);
            }
          });
        }
      };

      order.forEach((id) => { renderNode(id, 0); });
      viewState.treeNodes = list;
      viewState.selectedNodeId = state.selectedNode?.id ?? null;
    };

    const handleDelta = (data) => {
      const recentEvents = Array.isArray(data?.recent_events) ? data.recent_events : [];
      if (!recentEvents.length) return;

      recentEvents.forEach((event) => {
        appendTaskLog(event, { limit: 200 });
        const agentId = event?.agent_id || event?.data?.agent_id;
        if (!agentId) return;
        const newStatus = event?.status || event?.data?.status || event?.state || event?.data?.state;
        if (newStatus) {
          const normalizedStatus = safeText(newStatus).trim();
          viewState.treeNodes = viewState.treeNodes.map((node) =>
            node.id === String(agentId)
              ? {
                ...node,
                status: normalizedStatus
              }
              : node
          );
        }

        if (state.selectedNode?.id === agentId && ui.taskStatusDisplay) {
          const node = viewState.treeNodes.find((item) => item.id === String(agentId));
          const displayStatus = newStatus || node?.status || "unknown";
          ui.taskStatusDisplay.textContent = safeText(displayStatus);
        }
      });
      state.recentEvents = [...state.recentEvents, ...recentEvents].slice(-200);
      // Debounced fetchTree() to pick up new nodes/edges after delta updates
      if (state.deltaFetchTimer) {
        clearTimeout(state.deltaFetchTimer);
      }
      state.deltaFetchTimer = setTimeout(() => {
        state.deltaFetchTimer = null;
        void fetchTree();
      }, 300);
    };

    const selectNode = (nodeId, agent) => {
      state.selectedNode = { id: nodeId, agent };
      updateMobileControlsState();
      if (!ui.taskDetailsSection) return;

      ui.taskDetailsSection.classList.remove("is-hidden");
      // Hide add task button when details panel is open to prevent pointer interception
      toggleHidden(addTaskBtn, true);
      viewState.selectedNodeId = nodeId;
      if (ui.taskDetailsTitle) {
        const label = labelForAgent(agent, nodeId);
        ui.taskDetailsTitle.textContent = safeText(label);
      }

      if (ui.taskSummaryDisplay) {
        const summary = stepForAgent(agent) || labelForAgent(agent, nodeId);
        ui.taskSummaryDisplay.textContent = safeText(summary);
      }

      if (ui.taskStatusDisplay) {
        const status = stateForAgent(agent) || "unknown";
        ui.taskStatusDisplay.textContent = safeText(status);
      }

      renderPlanSubtasks(agent);

      if (agent?.id) {
        fetchSop(agent.id);
        loadChatHistory(agent.id);
        loadSkills(agent.id);
      }

      if (!window.Alpine) {
        const prevSelected = ui.taskTreeRoot?.querySelector(".task-tree-node.is-selected");
        if (prevSelected) prevSelected.classList.remove("is-selected");

        const currentNode = ui.taskTreeRoot?.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`);
        if (currentNode) currentNode.classList.add("is-selected");
      }
    };

    viewState.selectNode = (node) => {
      if (!node || node.id == null) return;
      selectNode(node.id, node.agent);
    };

    const fetchSop = async (agentId) => {
      if (!agentId || !ui.taskSopDisplay) return;
      try {
        const resp = await apiFetch(`/api/agents/${encodeURIComponent(agentId)}/sop`, { method: "GET" });
        const ct = safeText(resp.headers.get("content-type")).toLowerCase();
        let mdText = "";
        if (ct.includes("application/json")) {
          const data = await resp.json().catch(() => null);
          mdText = safeText(data?.md_text ?? data?.mdText ?? data?.markdown ?? data?.text ?? data?.sop ?? "");
        } else {
          mdText = await resp.text();
        }
        ui.taskSopDisplay.textContent = mdText || t("taskTree.sop");
      } catch (err) {
        if (handleAuthError(err)) return;
        setMessage(t("taskTree.msg.fetchSopFailed"), "error");
      }
    };

    const renderSkills = (agentId) => {
      if (!ui.taskSkillsList || !ui.taskSkillsEmpty) return;
      ui.taskSkillsList.innerHTML = "";
      const skills = Array.isArray(state.skillsByAgent?.[agentId]) ? state.skillsByAgent[agentId] : [];
      toggleHidden(ui.taskSkillsEmpty, skills.length > 0);
      skills.forEach((skill) => {
        const name = safeText(skill?.name || "").trim();
        const filename = safeText(skill?.filename || "").trim();
        const li = document.createElement("li");
        li.className = "skill-item";

        const meta = document.createElement("div");
        meta.className = "skill-meta";
        const nameEl = document.createElement("div");
        nameEl.className = "skill-name";
        nameEl.textContent = name || "-";
        meta.appendChild(nameEl);
        if (filename) {
          const fileEl = document.createElement("div");
          fileEl.className = "skill-filename";
          fileEl.textContent = filename;
          meta.appendChild(fileEl);
        }
        li.appendChild(meta);
        ui.taskSkillsList.appendChild(li);
      });
    };

    const renderSkillSearchResults = () => {
      if (!ui.taskSkillSearchResults || !ui.taskSkillSearchEmpty) return;
      ui.taskSkillSearchResults.innerHTML = "";
      const results = Array.isArray(state.communitySearchResults) ? state.communitySearchResults : [];
      const hasQuery = Boolean(state.communitySearchQuery);
      toggleHidden(ui.taskSkillSearchEmpty, !hasQuery || results.length > 0);
      results.forEach((skill) => {
        const name = safeText(skill?.name || skill?.key || "").trim();
        const desc = safeText(skill?.description || skill?.summary || "").trim();
        const li = document.createElement("li");
        li.className = "skill-result";

        const meta = document.createElement("div");
        meta.className = "skill-meta";
        const nameEl = document.createElement("div");
        nameEl.className = "skill-name";
        nameEl.textContent = name || "-";
        meta.appendChild(nameEl);
        if (desc) {
          const descEl = document.createElement("div");
          descEl.className = "skill-desc";
          descEl.textContent = desc;
          meta.appendChild(descEl);
        }
        li.appendChild(meta);
        ui.taskSkillSearchResults.appendChild(li);
      });
    };

    const populateCommunitySkills = () => {
      if (!ui.taskSkillSelect) return;
      ui.taskSkillSelect.innerHTML = "";
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = t("taskTree.installSkill");
      ui.taskSkillSelect.appendChild(placeholder);

      const skills = Array.isArray(state.communitySkills) ? state.communitySkills : [];
      skills.forEach((skill) => {
        const key = safeText(skill?.key || "").trim();
        const name = safeText(skill?.name || "").trim();
        if (!key || !name) return;
        const option = document.createElement("option");
        option.value = key;
        option.textContent = name;
        ui.taskSkillSelect.appendChild(option);
      });
    };

    const searchCommunitySkills = async () => {
      if (!ui.taskSkillSearchInput) return;
      const query = ui.taskSkillSearchInput.value.trim();
      state.communitySearchQuery = query;
      if (!query) {
        state.communitySearchResults = [];
        renderSkillSearchResults();
        return;
      }
      try {
        const resp = await apiFetch(`/api/community-skills/search?query=${encodeURIComponent(query)}`, { method: "GET" });
        const data = await resp.json().catch(() => null);
        const results = Array.isArray(data?.skills) ? data.skills : Array.isArray(data?.results) ? data.results : [];
        state.communitySearchResults = results;
        renderSkillSearchResults();
      } catch (err) {
        if (handleAuthError(err)) return;
        setMessage(t("taskTree.msg.skillsSearchFailed"), "error");
      }
    };

    const loadCommunitySkills = async () => {
      try {
        const resp = await apiFetch("/api/community-skills", { method: "GET" });
        const data = await resp.json().catch(() => null);
        const skills = Array.isArray(data?.skills) ? data.skills : [];
        state.communitySkills = skills;
        populateCommunitySkills();
      } catch (err) {
        if (handleAuthError(err)) return;
        setMessage(t("taskTree.msg.skillsLoadFailed"), "error");
      }
    };

    const loadSkills = async (agentId) => {
      if (!agentId || !state.runId) return;
      if (!ui.taskSkillsList) return;
      try {
        const resp = await apiFetch(
          `/api/runs/${encodeURIComponent(state.runId)}/agents/${encodeURIComponent(agentId)}/skills`,
          { method: "GET" }
        );
        const data = await resp.json().catch(() => null);
        const skills = Array.isArray(data?.skills) ? data.skills : [];
        state.skillsByAgent[agentId] = skills;
        renderSkills(agentId);
      } catch (err) {
        if (handleAuthError(err)) return;
        setMessage(t("taskTree.msg.skillsLoadFailed"), "error");
      }
    };

    const installSelectedSkill = async () => {
      const agentId = state.selectedNode?.id;
      if (!agentId || !state.runId || !ui.taskSkillSelect) {
        setMessage(t("sop.msg.needAgent"), "error");
        return;
      }
      const skillKey = ui.taskSkillSelect.value.trim();
      if (!skillKey) return;
      try {
        const resp = await apiFetch(
          `/api/runs/${encodeURIComponent(state.runId)}/agents/${encodeURIComponent(agentId)}/skills/install`,
          {
            method: "POST",
            body: JSON.stringify({ skill_key: skillKey })
          }
        );
        const data = await resp.json().catch(() => null);
        const skills = Array.isArray(data?.skills) ? data.skills : [];
        state.skillsByAgent[agentId] = skills;
        renderSkills(agentId);
        setMessage(t("taskTree.msg.skillsInstallOk"), "ok");
      } catch (err) {
        if (handleAuthError(err)) return;
        setMessage(t("taskTree.msg.skillsInstallFailed"), "error");
      }
    };

    const installSkillByNl = async () => {
      const agentId = state.selectedNode?.id;
      if (!agentId) {
        setMessage(t("sop.msg.needAgent"), "error");
        return;
      }
      if (!state.runId) {
        setMessage(t("sop.msg.needRun"), "error");
        return;
      }
      if (!ui.taskSkillNlInput) return;
      const query = ui.taskSkillNlInput.value.trim();
      if (!query) return;
      try {
        const resp = await apiFetch(
          `/api/runs/${encodeURIComponent(state.runId)}/agents/${encodeURIComponent(agentId)}/skills/install-nl`,
          {
            method: "POST",
            body: JSON.stringify({ query })
          }
        );
        const data = await resp.json().catch(() => null);
        const skills = Array.isArray(data?.skills) ? data.skills : [];
        state.skillsByAgent[agentId] = skills;
        renderSkills(agentId);
        ui.taskSkillNlInput.value = "";
        setMessage(t("taskTree.msg.skillsInstallNlOk"), "ok");
      } catch (err) {
        if (handleAuthError(err)) return;
        setMessage(t("taskTree.msg.skillsInstallNlFailed"), "error");
      }
    };

    const loadChatHistory = (agentId) => {
      if (!ui.taskChatMessages) return;
      const key = `roboard_chat_${agentId}`;
      try {
        const stored = localStorage.getItem(key);
        state.chatHistories[agentId] = stored ? JSON.parse(stored) : [];
      } catch {
        state.chatHistories[agentId] = [];
      }
      renderChat(agentId);
    };

    const renderChat = (agentId) => {
      if (!ui.taskChatMessages) return;
      ui.taskChatMessages.innerHTML = "";
      const messages = state.chatHistories[agentId] || [];
      messages.forEach((msg) => {
        const div = document.createElement("div");
        div.className = `chat-message chat-${msg.role}`;
        div.textContent = `${msg.role}: ${safeText(msg.content)}`;
        ui.taskChatMessages.appendChild(div);
      });
      ui.taskChatMessages.scrollTop = ui.taskChatMessages.scrollHeight;
    };

    const logout = async () => {
      if (!state.session) {
        redirectToLogin();
        return;
      }
      try {
        await apiFetch("/api/auth/logout", { method: "POST" });
      } catch {
      }
      disconnectWs();
      localStorage.removeItem(STORAGE.runId);
      setMessage("", null);
      setConnectionStatus("idle");
      clearTaskLog();
      renderKanban([]);
      state.runId = "";
      state.selectedNode = null;
      updateMobileControlsState();
      redirectToLogin();
    };

    const bootstrapAuth = async () => {
      try {
        const me = await fetchMe();
        state.session = me;
        setSessionUi(me);
        setConnectionStatus("idle");
        await loadCommunitySkills();

        const storedRunId = localStorage.getItem(STORAGE.runId);
        if (storedRunId) {
          try {
            // Validate stored run_id before connecting
            const resp = await apiFetch(`/api/runs/${encodeURIComponent(storedRunId)}/tree`, { method: "GET" });
            if (resp.ok) {
              // Validation successful, proceed with connection
              state.runId = storedRunId;
              updateMobileControlsState();
              connectWs();
            }
          } catch (err) {
            const status = err && typeof err === "object" ? err.status : null;
            if (status === 401 || status === 403 || status === 404) {
              // Validation failed, clear stored run_id and update UI
              localStorage.removeItem(STORAGE.runId);
              state.runId = "";
              setConnectionStatus("idle");
              setMessage("历史任务不可访问，已清理。请创建新任务。", "warn");
              updateMobileControlsState();
            } else {
              // Other errors, still clear run_id to be safe
              localStorage.removeItem(STORAGE.runId);
              state.runId = "";
              setConnectionStatus("idle");
              setMessage("历史任务不可访问，已清理。请创建新任务。", "warn");
              updateMobileControlsState();
            }
          }
        }
      } catch (err) {
        const status = err && typeof err === "object" ? err.status : null;
        if (status === 401 || status === 403) {
          redirectToLogin();
        } else {
          setMessage("Unable to reach /api/auth/me.", "error");
        }
      }
    };

    if (addTaskBtn) addTaskBtn.addEventListener("click", openModal);
    if (ui.closeModalBtn) ui.closeModalBtn.addEventListener("click", closeModal);
    if (ui.cancelTaskBtn) ui.cancelTaskBtn.addEventListener("click", closeModal);
    if (ui.overlay) ui.overlay.addEventListener("click", closeModal);

    if (ui.addTaskForm) {
      ui.addTaskForm.addEventListener("submit", (e) => {
        e.preventDefault();
        void createRun();
      });
    }

    if (ui.closeDetailsBtn) {
      ui.closeDetailsBtn.addEventListener("click", (e) => {
        e.preventDefault();
        closeDetails();
      });
    }

    if (ui.taskDetailsOverlay) {
      ui.taskDetailsOverlay.addEventListener("click", closeDetails);
    }

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && ui.taskDetailsSection && !ui.taskDetailsSection.classList.contains("is-hidden")) {
        closeDetails();
      }
    });

    if (ui.taskSkillSearchForm) {
      ui.taskSkillSearchForm.addEventListener("submit", (e) => {
        e.preventDefault();
        void searchCommunitySkills();
      });
    }
    if (ui.taskSkillNlForm) {
      ui.taskSkillNlForm.addEventListener("submit", (e) => {
        e.preventDefault();
        void installSkillByNl();
      });
    }
    if (ui.taskSkillInstall) {
      ui.taskSkillInstall.addEventListener("click", (e) => {
        e.preventDefault();
        void installSelectedSkill();
      });
    }
    if (ui.logoutBtn) {
      ui.logoutBtn.addEventListener("click", (e) => {
        e.preventDefault();
        void logout();
      });
    }

    updateMobileControlsState();
    setTaskLogEmpty();

    // User dropdown behavior
    const setupUserDropdown = () => {
      if (!ui.userDropdownTrigger || !ui.userDropdownMenu) return;

      const isDesktopHover = () => window.matchMedia?.("(hover: hover)")?.matches === true;

      const toggleDropdown = (show) => {
        const shouldShow = show !== undefined ? show : ui.userDropdownMenu.classList.contains("is-hidden");
        ui.userDropdownMenu.classList.toggle("is-hidden", !shouldShow);
        ui.userDropdownTrigger.setAttribute("aria-expanded", shouldShow ? "true" : "false");
      };

      const closeDropdown = () => toggleDropdown(false);
      const openDropdown = () => toggleDropdown(true);

      // Click toggles
      ui.userDropdownTrigger.addEventListener("click", (e) => {
        e.preventDefault();
        const isHidden = ui.userDropdownMenu.classList.contains("is-hidden");
        toggleDropdown(isHidden);
      });

      // Hover opens on desktop
      if (isDesktopHover()) {
        ui.userDropdownTrigger.addEventListener("mouseenter", openDropdown);
        ui.userDropdownTrigger.addEventListener("mouseleave", () => {
          // Delay to allow moving to menu
          setTimeout(() => {
            if (!ui.userDropdownMenu.matches(":hover") && !ui.userDropdownTrigger.matches(":hover")) {
              closeDropdown();
            }
          }, 100);
        });

        ui.userDropdownMenu.addEventListener("mouseleave", () => {
          setTimeout(() => {
            if (!ui.userDropdownMenu.matches(":hover") && !ui.userDropdownTrigger.matches(":hover")) {
              closeDropdown();
            }
          }, 100);
        });
      }

      // Outside click closes
      document.addEventListener("click", (e) => {
        if (!ui.userDropdownTrigger.contains(e.target) && !ui.userDropdownMenu.contains(e.target)) {
          closeDropdown();
        }
      });

      // Escape key closes
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !ui.userDropdownMenu.classList.contains("is-hidden")) {
          closeDropdown();
          ui.userDropdownTrigger.focus();
        }
      });
    };

    setupUserDropdown();
    setupViewTabs();

    void bootstrapAuth();
    window.addEventListener("beforeunload", () => disconnectWs());
  };

  setupLangToggle();
  applyI18n();
  initLoginPage();
  initRunConsolePage();
  initTaskTreePage();
})();
