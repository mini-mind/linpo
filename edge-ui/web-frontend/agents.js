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
      // 使用默认 Agent 列表作为后备
      state.availableAgents = [
        {
          id: "searcher",
          name: "搜索专家",
          role: "searcher",
          description: "专门用于网络搜索和信息收集的专家 Agent",
          version: 1,
          skills: [{ name: "search_web", builtin: true }, { name: "citation_minify", builtin: true }],
          tools: [{ name: "searxng", endpoint: "http://mcp-server:9000/search" }],
          tags: ["搜索", "信息收集"],
          sop: "# Searcher SOP\n\n职责:\n- 根据关键词进行网络搜索\n- 过滤和整理搜索结果\n- 返回带引用的结果摘要\n\n步骤:\n1. 接收搜索请求\n2. 调用 searxng 执行搜索\n3. 过滤低质量结果\n4. 整理并返回结果"
        },
        {
          id: "analyzer",
          name: "分析专家",
          role: "analyzer",
          description: "专门用于数据分析和报告生成的专家 Agent",
          version: 1,
          skills: [{ name: "analyze_data", builtin: true }],
          tools: [],
          tags: ["分析", "报告"],
          sop: "# Analyzer SOP\n\n职责:\n- 分析收集到的数据\n- 生成分析报告\n- 提供洞察和建议\n\n步骤:\n1. 接收数据\n2. 分析数据模式\n3. 生成报告\n4. 提供建议"
        },
        {
          id: "writer",
          name: "撰写专家",
          role: "writer",
          description: "专门用于文档撰写和内容编辑的专家 Agent",
          version: 1,
          skills: [{ name: "write_document", builtin: true }],
          tools: [],
          tags: ["写作", "编辑"],
          sop: "# Writer SOP\n\n职责:\n- 根据要求撰写文档\n- 编辑和优化内容\n- 确保格式规范\n\n步骤:\n1. 理解需求\n2. 收集素材\n3. 撰写初稿\n4. 编辑优化"
        },
        {
          id: "reviewer",
          name: "审核专家",
          role: "reviewer",
          description: "专门用于内容审核和质量检查的专家 Agent",
          version: 1,
          skills: [{ name: "review_content", builtin: true }],
          tools: [],
          tags: ["审核", "质量"],
          sop: "# Reviewer SOP\n\n职责:\n- 审核内容质量\n- 检查错误和问题\n- 提供改进建议\n\n步骤:\n1. 接收内容\n2. 检查质量\n3. 标记问题\n4. 提供建议"
        }
      ];
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

      // TODO: 对接实例化 API
      // 目前仅做演示，后续需要实现：
      // POST /api/runs/{run_id}/agents/instantiate

      // 临时实现：创建一个新 run 并使用模板
      let targetRunId = runId;
      
      if (!targetRunId) {
        // 创建新 run
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

      // TODO: 实例化 Agent
      // await apiFetch(`/api/runs/${targetRunId}/agents/instantiate`, {
      //   method: "POST",
      //   body: JSON.stringify({
      //     template_id: template.id,
      //     overrides: {}
      //   })
      // });

      alert(`即将招募 Agent：${template.name}\nRun ID: ${targetRunId}\n\n实例化功能开发中，后续将支持从模板快速创建 Agent。`);

      state.showRecruitModal = false;
    } catch (err) {
      console.error("Failed to recruit agent:", err);
      alert(t("agentRecruit.msg.recruitFailed"));
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

      // TODO: 对接自定义 Agent 创建 API
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
