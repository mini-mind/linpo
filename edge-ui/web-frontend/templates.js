/**
 * RoBoard Agent Template Library UI
 * 模板库浏览与实例化界面
 */

(() => {
  const byId = (id) => document.getElementById(id);

  const safeText = (value) => (value == null ? "" : String(value));

  const STORAGE = {
    lang: "roboard_lang",
    sessionToken: "roboard_session_token"
  };

  // 国际化字符串
  const STRINGS = {
    zh: {
      "templates.title": "Agent 模板库",
      "templates.subtitle": "选择预制 Agent 模板，快速构建您的智能体团队",
      "templates.loading": "加载模板中...",
      "templates.empty": "暂无可用模板",
      "templates.skills": "绑定技能:",
      "templates.useButton": "使用此模板",
      "templates.cancel": "取消",
      "templates.confirm": "确认使用",
      "templates.using": "使用中...",
      "templates.useModal.title": "使用模板",
      "templates.useModal.description": "选择此模板将创建一个新的 Agent 实例。",
      "templates.details.overview": "基本信息",
      "templates.details.id": "模板 ID",
      "templates.details.role": "角色",
      "templates.details.version": "版本",
      "templates.details.skills": "绑定技能",
      "templates.details.tools": "工具绑定",
      "templates.details.sop": "SOP 预览",
      "templates.details.tags": "标签",
      "taskTree.logout": "退出",
      "templates.msg.loadFailed": "加载模板失败",
      "templates.msg.useSuccess": "模板使用成功",
      "templates.msg.useFailed": "使用模板失败",
      "templates.msg.authRequired": "请先登录"
    },
    en: {
      "templates.title": "Agent Template Library",
      "templates.subtitle": "Select a预制 agent template to quickly build your agent team",
      "templates.loading": "Loading templates...",
      "templates.empty": "No templates available",
      "templates.skills": "Skills:",
      "templates.useButton": "Use This Template",
      "templates.cancel": "Cancel",
      "templates.confirm": "Confirm",
      "templates.using": "Using...",
      "templates.useModal.title": "Use Template",
      "templates.useModal.description": "Selecting this template will create a new agent instance.",
      "templates.details.overview": "Overview",
      "templates.details.id": "Template ID",
      "templates.details.role": "Role",
      "templates.details.version": "Version",
      "templates.details.skills": "Bound Skills",
      "templates.details.tools": "Tools",
      "templates.details.sop": "SOP Preview",
      "templates.details.tags": "Tags",
      "taskTree.logout": "Logout",
      "templates.msg.loadFailed": "Failed to load templates",
      "templates.msg.useSuccess": "Template used successfully",
      "templates.msg.useFailed": "Failed to use template",
      "templates.msg.authRequired": "Please login first"
    }
  };

  // 模板角色图标映射
  const ROLE_ICONS = {
    searcher: "🔍",
    analyzer: "📊",
    writer: "✍️",
    reviewer: "✅",
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
    document.title = t("templates.title") + " - RoBoard";

    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (key) el.textContent = t(key);
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
  const initTemplateLibState = () => {
    const viewState = window.Alpine?.reactive
      ? window.Alpine.reactive({
          loading: true,
          templates: [],
          selectedTemplate: null,
          showUseModal: false,
          usingTemplate: false,
          sessionLabel: ""
        })
      : {
          loading: true,
          templates: [],
          selectedTemplate: null,
          showUseModal: false,
          usingTemplate: false,
          sessionLabel: ""
        };

    window.templateLibState = viewState;

    viewState.init = async () => {
      await loadTemplates();
      await checkAuth();
      setupUserDropdown();
    };

    viewState.selectTemplate = (template) => {
      viewState.selectedTemplate = template;
    };

    viewState.closeDetails = () => {
      viewState.selectedTemplate = null;
    };

    viewState.useTemplate = (template) => {
      viewState.selectedTemplate = template;
      viewState.showUseModal = true;
    };

    viewState.closeUseModal = () => {
      viewState.showUseModal = false;
    };

    viewState.confirmUseTemplate = async () => {
      await handleUseTemplate();
    };

    viewState.getTemplateIcon = (role) => {
      return ROLE_ICONS[role] || ROLE_ICONS.default;
    };

    return viewState;
  };

  // 加载模板列表
  const loadTemplates = async () => {
    const state = window.templateLibState;
    if (!state) return;

    state.loading = true;

    try {
      const resp = await apiFetch("/api/agent-templates");
      const templates = await resp.json();

      // 加载每个模板的详细信息
      const detailedTemplates = await Promise.all(
        templates.map(async (t) => {
          try {
            const detailResp = await apiFetch(`/api/agent-templates/${t.id}`);
            return await detailResp.json();
          } catch {
            return t;
          }
        })
      );

      state.templates = detailedTemplates;
    } catch (err) {
      console.error("Failed to load templates:", err);
      state.templates = [];
    } finally {
      state.loading = false;
    }
  };

  // 检查认证状态
  const checkAuth = async () => {
    const state = window.templateLibState;
    if (!state) return;

    const me = await fetchMe();
    if (me) {
      const user = me.user || me;
      const email = safeText(user.email || user.username || "").trim();
      state.sessionLabel = email || "Signed in";
    } else {
      // 未登录，重定向到登录页
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

  // 处理使用模板
  const handleUseTemplate = async () => {
    const state = window.templateLibState;
    if (!state || !state.selectedTemplate) return;

    state.usingTemplate = true;

    try {
      // TODO: 对接实例化 API
      // 目前仅做演示，后续需要实现：
      // POST /api/runs/{run_id}/agents/instantiate
      // 或者创建新的 run 并实例化模板

      // 临时实现：创建一个新 run 并使用模板
      const template = state.selectedTemplate;

      // 提示用户模板功能开发中
      alert(`即将使用模板：${template.name}\n\n实例化功能开发中，后续将支持从模板快速创建 Agent。`);

      state.showUseModal = false;
    } catch (err) {
      console.error("Failed to use template:", err);
      alert(t("templates.msg.useFailed"));
    } finally {
      state.usingTemplate = false;
    }
  };

  // 页面初始化
  const initPage = () => {
    setupLangToggle();
    applyI18n();
    initTemplateLibState();
  };

  // 启动
  initPage();
})();
