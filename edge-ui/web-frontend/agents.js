/**
 * RoBoard Agent Recruit UI
 * Agent 招募与实例化界面
 */

(() => {
  const byId = (id) => document.getElementById(id);

  const safeText = (value) => (value == null ? "" : String(value));

  const STORAGE = {
    lang: "roboard_lang",
    sessionToken: "roboard_session_token",
    runId: "roboard_run_id"
  };

  // 国际化字符串
  const STRINGS = {
    zh: {
      "agentRecruit.title": "Agent 招募",
      "agentRecruit.subtitle": "从预制模板或自定义创建 Agent，组建您的智能体团队",
      "agentRecruit.loading": "加载中...",
      "agentRecruit.emptyTemplates": "暂无可用模板",
      "agentRecruit.skills": "绑定技能:",
      "agentRecruit.recruitButton": "招募此 Agent",
      "agentRecruit.cancel": "取消",
      "agentRecruit.confirm": "确认招募",
      "agentRecruit.recruiting": "招募中...",
      "agentRecruit.creating": "创建中...",
      "agentRecruit.tabTemplates": "预制模板",
      "agentRecruit.tabCustom": "自定义创建",
      "agentRecruit.nameLabel": "Agent 名称",
      "agentRecruit.namePlaceholder": "例如：数据分析专家",
      "agentRecruit.roleLabel": "角色",
      "agentRecruit.roleSelect": "选择角色",
      "agentRecruit.descriptionLabel": "职责描述",
      "agentRecruit.descriptionPlaceholder": "描述这个 Agent 的职责和能力...",
      "agentRecruit.sopLabel": "SOP (可选)",
      "agentRecruit.sopPlaceholder": "# Agent SOP\n\n职责:\n- ...\n\n步骤:\n1. ...\n2. ...",
      "agentRecruit.createButton": "创建 Agent",
      "agentRecruit.details.overview": "基本信息",
      "agentRecruit.details.id": "Agent ID",
      "agentRecruit.details.role": "角色",
      "agentRecruit.details.version": "版本",
      "agentRecruit.details.skills": "绑定技能",
      "agentRecruit.details.tools": "工具绑定",
      "agentRecruit.details.sop": "SOP 预览",
      "agentRecruit.details.tags": "标签",
      "agentRecruit.recruitModal.title": "招募 Agent",
      "agentRecruit.recruitModal.description": "选择要招募到的 Run ID（可选，留空则创建新 Run）",
      "agentRecruit.recruitModal.runLabel": "Run ID",
      "agentRecruit.recruitModal.runPlaceholder": "留空则创建新 Run",
      "agentRecruit.statusIdle": "空闲",
      "taskTree.logout": "退出",
      "agentRecruit.msg.loadFailed": "加载 Agent 列表失败",
      "agentRecruit.msg.recruitSuccess": "Agent 招募成功",
      "agentRecruit.msg.recruitFailed": "招募 Agent 失败",
      "agentRecruit.msg.createSuccess": "Agent 创建成功",
      "agentRecruit.msg.createFailed": "创建 Agent 失败",
      "agentRecruit.msg.authRequired": "请先登录"
    },
    en: {
      "agentRecruit.title": "Agent Recruit",
      "agentRecruit.subtitle": "Recruit agents from templates or custom creation to build your agent team",
      "agentRecruit.loading": "Loading...",
      "agentRecruit.emptyTemplates": "No templates available",
      "agentRecruit.skills": "Skills:",
      "agentRecruit.recruitButton": "Recruit This Agent",
      "agentRecruit.cancel": "Cancel",
      "agentRecruit.confirm": "Confirm",
      "agentRecruit.recruiting": "Recruiting...",
      "agentRecruit.creating": "Creating...",
      "agentRecruit.tabTemplates": "Templates",
      "agentRecruit.tabCustom": "Custom",
      "agentRecruit.nameLabel": "Agent Name",
      "agentRecruit.namePlaceholder": "e.g., Data Analysis Expert",
      "agentRecruit.roleLabel": "Role",
      "agentRecruit.roleSelect": "Select a role",
      "agentRecruit.descriptionLabel": "Description",
      "agentRecruit.descriptionPlaceholder": "Describe the agent's responsibilities and capabilities...",
      "agentRecruit.sopLabel": "SOP (Optional)",
      "agentRecruit.sopPlaceholder": "# Agent SOP\n\nResponsibilities:\n- ...\n\nSteps:\n1. ...\n2. ...",
      "agentRecruit.createButton": "Create Agent",
      "agentRecruit.details.overview": "Overview",
      "agentRecruit.details.id": "Agent ID",
      "agentRecruit.details.role": "Role",
      "agentRecruit.details.version": "Version",
      "agentRecruit.details.skills": "Bound Skills",
      "agentRecruit.details.tools": "Tools",
      "agentRecruit.details.sop": "SOP Preview",
      "agentRecruit.details.tags": "Tags",
      "agentRecruit.recruitModal.title": "Recruit Agent",
      "agentRecruit.recruitModal.description": "Select a Run ID to recruit to (optional, leave empty to create new Run)",
      "agentRecruit.recruitModal.runLabel": "Run ID",
      "agentRecruit.recruitModal.runPlaceholder": "Leave empty to create new Run",
      "agentRecruit.statusIdle": "Idle",
      "taskTree.logout": "Logout",
      "agentRecruit.msg.loadFailed": "Failed to load agents",
      "agentRecruit.msg.recruitSuccess": "Agent recruited successfully",
      "agentRecruit.msg.recruitFailed": "Failed to recruit agent",
      "agentRecruit.msg.createSuccess": "Agent created successfully",
      "agentRecruit.msg.createFailed": "Failed to create agent",
      "agentRecruit.msg.authRequired": "Please login first"
    }
  };

  // Agent 角色图标映射
  const ROLE_ICONS = {
    searcher: "🔍",
    analyzer: "📊",
    writer: "✍️",
    reviewer: "✅",
    lead: "👔",
    custom: "🤖",
    default: "🤖"
  };

  // 检测语言
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
    document.title = t("agentRecruit.title") + " - RoBoard";

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

  // API 请求封装
  const apiFetch = async (path, init = {}) => {
    const headers = new Headers(init.headers || {});
    if (!headers.has("Accept")) headers.set("Accept", "application/json");

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

  // 检查登录状态
  const fetchMe = async () => {
    try {
      const resp = await apiFetch("/api/auth/me", { method: "GET" });
      const data = await resp.json().catch(() => null);
      return data && typeof data === "object" ? data : null;
    } catch {
      return null;
    }
  };

  // 初始化 Alpine.js 状态
  const initAgentRecruitState = () => {
    const viewState = window.Alpine?.reactive
      ? window.Alpine.reactive({
          loading: true,
          activeTab: "templates",
          availableAgents: [],
          selectedAgent: null,
          showDetailsModal: false,
          showRecruitModal: false,
          recruiting: false,
          creating: false,
          sessionLabel: ""
        })
      : {
          loading: true,
          activeTab: "templates",
          availableAgents: [],
          selectedAgent: null,
          showDetailsModal: false,
          showRecruitModal: false,
          recruiting: false,
          creating: false,
          sessionLabel: ""
        };

    window.agentRecruitState = viewState;

    viewState.init = async () => {
      await loadAgents();
      await checkAuth();
      setupUserDropdown();
    };

    viewState.selectAgent = (agent) => {
      viewState.selectedAgent = agent;
      viewState.showDetailsModal = true;
    };

    viewState.closeDetails = () => {
      viewState.showDetailsModal = false;
    };

    viewState.recruitAgent = (agent) => {
      viewState.selectedAgent = agent;
      viewState.showRecruitModal = true;
    };

    viewState.closeRecruitModal = () => {
      viewState.showRecruitModal = false;
    };

    viewState.confirmRecruit = async () => {
      await handleRecruit();
    };

    viewState.confirmRecruitAction = async () => {
      await handleRecruit();
    };

    viewState.getAgentIcon = (role) => {
      return ROLE_ICONS[role] || ROLE_ICONS.default;
    };

    return viewState;
  };

  // 加载 Agent 列表
  const loadAgents = async () => {
    const state = window.agentRecruitState;
    if (!state) return;

    state.loading = true;

    try {
      // 从 Agent 模板 API 加载
      const resp = await apiFetch("/api/agent-templates");
      const templates = await resp.json();

      // 加载每个模板的详细信息
      const detailedAgents = await Promise.all(
        templates.map(async (t) => {
          try {
            const detailResp = await apiFetch(`/api/agent-templates/${t.id}`);
            return await detailResp.json();
          } catch {
            return t;
          }
        })
      );

      state.availableAgents = detailedAgents;
    } catch (err) {
      console.error("Failed to load agents:", err);
      state.availableAgents = [];
    } finally {
      state.loading = false;
    }
  };

  // 检查认证状态
  const checkAuth = async () => {
    const state = window.agentRecruitState;
    if (!state) return;

    const me = await fetchMe();
    if (me) {
      const user = me.user || me;
      const email = safeText(user.email || user.username || "").trim();
      state.sessionLabel = email || "Signed in";
    } else {
      window.location.assign("/login");
    }
  };

  // 用户下拉菜单
  const setupUserDropdown = () => {
    const trigger = byId("user-dropdown-trigger");
    const menu = byId("user-dropdown-menu");
    const logoutBtn = byId("logout-btn");

    if (!trigger || !menu) return;

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const isHidden = menu.classList.contains("is-hidden");
      menu.classList.toggle("is-hidden", !isHidden);
      trigger.setAttribute("aria-expanded", isHidden ? "true" : "false");
    });

    document.addEventListener("click", () => {
      menu.classList.add("is-hidden");
      trigger.setAttribute("aria-expanded", "false");
    });

    if (logoutBtn) {
      logoutBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        try {
          await apiFetch("/api/auth/logout", { method: "POST" });
        } catch {
          // Ignore logout errors
        }
        localStorage.removeItem(STORAGE.sessionToken);
        window.location.assign("/login");
      });
    }
  };

  // 处理招募 Agent
  const handleRecruit = async () => {
    const state = window.agentRecruitState;
    if (!state || !state.selectedAgent) return;

    state.recruiting = true;

    try {
      const runIdInput = byId("recruit-run-id");
      const runId = runIdInput ? runIdInput.value.trim() : "";
      const template = state.selectedAgent;
      let targetRunId = runId;

      if (!targetRunId) {
        const resp = await apiFetch("/api/runs", {
          method: "POST",
          body: JSON.stringify({
            input_nl: `从模板创建 Agent: ${template.name}`,
            input: {}
          })
        });
        const data = await resp.json();
        targetRunId = data.run_id;
        localStorage.setItem(STORAGE.runId, targetRunId);
      }

      const overrides = {};
      if (safeText(template.role).trim()) {
        overrides.role = safeText(template.role).trim();
      }
      if (Array.isArray(template.skills) && template.skills.length > 0) {
        const normalizedSkills = template.skills
          .map((item) => {
            const name = safeText(item?.name).trim();
            if (!name) return null;
            const normalized = { name };
            const filename = safeText(item?.filename).trim();
            const code = safeText(item?.code);
            if (filename) normalized.filename = filename;
            if (code.trim()) normalized.code = code;
            return normalized;
          })
          .filter(Boolean);
        if (normalizedSkills.length > 0) {
          overrides.skills = normalizedSkills;
        }
      }

      await apiFetch(`/api/runs/${encodeURIComponent(targetRunId)}/recruitments`, {
        method: "POST",
        body: JSON.stringify({
          template_id: template.id,
          overrides
        })
      });

      state.showRecruitModal = false;
      window.location.assign("/");
    } catch (err) {
      console.error("Failed to recruit agent:", err);
    } finally {
      state.recruiting = false;
    }
  };

  // 处理自定义 Agent 创建
  const submitCustomAgent = async () => {
    const state = window.agentRecruitState;
    if (!state) return;

    const form = byId("custom-agent-form");
    if (!form) return;

    state.creating = true;

    try {
      const formData = new FormData(form);
      const agentData = {
        name: formData.get("name"),
        role: formData.get("role"),
        description: formData.get("description"),
        sop: formData.get("sop") || ""
      };

      console.log("Creating custom agent:", agentData);

      alert(`即将创建自定义 Agent：${agentData.name}\n\n自定义 Agent 创建功能开发中。`);

      form.reset();
    } catch (err) {
      console.error("Failed to create agent:", err);
      alert(t("agentRecruit.msg.createFailed"));
    } finally {
      state.creating = false;
    }
  };

  // 页面初始化
  const initPage = () => {
    setupLangToggle();
    applyI18n();
    initAgentRecruitState();
  };

  // 启动
  initPage();
})();
