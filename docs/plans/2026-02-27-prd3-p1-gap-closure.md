# PRD v3 P1 Gap Closure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 补齐 PRD v3 P1 缺口：社区技能搜索/自然语言安装/自动调用、Skill-creator 自举、三层技能分级、Docker 沙箱执行器。  
**Architecture:** api-backend 负责技能注册表搜索与安装、创建技能/执行技能的任务事件；agent-manager 消费技能任务并调用 skill-gateway；skill-gateway 通过 Docker 运行沙箱执行器；web-frontend 增加搜索与 NL 安装入口。  
**Tech Stack:** FastAPI, SQLAlchemy, pytest, Redis Streams, Docker SDK (python), vanilla JS/CSS/HTML

## PRD v3 P1 对比

| PRD v3 P1 条目 | PRD 位置 | 计划覆盖 | 状态 |
| --- | --- | --- | --- |
| Skill 自举（初版） | 3.5 / 5.P1 | Task 3（技能创建队列） | 覆盖 |
| 社区技能集成（搜索/安装/调用） | 3.6 / 5.P1 | Task 1 + Task 5 + Task 6 | 覆盖 |
| 团队架构导出/导入（YAML） | 3.7 / 5.P1 | Task 7 | 待补 |
| 多端协同（移动端基础查看） | 3.8 / 5.P1 | Task 8 | 待补 |

说明：Task 2（三层技能分级）与 Task 4（沙箱执行器）是为社区技能与自举安全/治理配套的技术实现，不直接出现在 PRD，但属于 P1 的落地保障。

---

### Task 1: 社区技能搜索 + NL 安装 API

**Files:**
- Modify: `session-b-api/app/config_loader.py`
- Modify: `session-b-api/app/tree_api.py`
- Create: `session-b-api/tests/test_community_skills_search.py`

**Step 1: Write the failing test**

```python
def test_search_and_install_by_nl(tmp_path, monkeypatch):
    # 1) create run
    # 2) GET /api/community-skills/search?query=hello -> returns hello_world
    # 3) POST /api/runs/{run_id}/agents/{agent_id}/skills/install-nl with query
    # 4) GET skills -> contains hello_world
    assert True
```

**Step 2: Run test to verify it fails**

Run: `cd api-backend && .venv/bin/python -m pytest -q tests/test_community_skills_search.py::test_search_and_install_by_nl`
Expected: FAIL (endpoint not found)

**Step 3: Write minimal implementation**

```python
# session-b-api/app/config_loader.py
def search_community_skills(query: str, *, limit: int = 5) -> list[dict[str, str]]: ...
```

```python
# session-b-api/app/tree_api.py
@router.get("/api/community-skills/search")
async def search_community_skills(...):
    # query + limit -> ranked list

@router.post("/api/runs/{run_id}/agents/{agent_id}/skills/install-nl")
async def install_community_skill_nl(...):
    # call search; pick top1; install; return skills list
```

**Step 4: Run test to verify it passes**

Run: `cd api-backend && .venv/bin/python -m pytest -q tests/test_community_skills_search.py::test_search_and_install_by_nl`
Expected: PASS

**Step 5: Commit**

```bash
```

---

### Task 2: 三层技能分级与租户技能存储

**Files:**
- Create: `config/builtin_skills.yaml`
- Modify: `session-b-api/app/project_fs.py`
- Modify: `session-b-api/app/agent_fs.py`
- Modify: `session-b-api/app/tree_api.py`
- Create: `session-b-api/tests/test_skill_tiers.py`

**Step 1: Write the failing test**

```python
def test_skill_tiers_catalog(tmp_path, monkeypatch):
    # 1) create tenant + run
    # 2) GET /api/skills/catalog -> builtin/platform/tenant tiers
    # 3) PUT tenant skill -> tenant tier includes it
    assert True
```

**Step 2: Run test to verify it fails**

Run: `cd api-backend && .venv/bin/python -m pytest -q tests/test_skill_tiers.py::test_skill_tiers_catalog`
Expected: FAIL (endpoint not found)

**Step 3: Write minimal implementation**

```yaml
# config/builtin_skills.yaml
skills:
  - key: search_web
    name: Web Search
    description: Built-in skill executed by sandbox executor
```

```python
# session-b-api/app/project_fs.py
def tenant_root_for(base: Path, tenant_id: int) -> Path: ...
```

```python
# session-b-api/app/agent_fs.py
def read_tenant_skills_manifest(tenant_root: Path) -> list[dict[str, str]]: ...
def write_tenant_skills_manifest(tenant_root: Path, skills: list[dict[str, str]]) -> None: ...
```

```python
# session-b-api/app/tree_api.py
@router.get("/api/skills/catalog")
async def get_skill_catalog(...):
    # builtin + platform (community) + tenant

@router.put("/api/skills/tenant")
async def put_tenant_skills(...):
    # write tenant manifest under data/tenants
```

**Step 4: Run test to verify it passes**

Run: `cd api-backend && .venv/bin/python -m pytest -q tests/test_skill_tiers.py::test_skill_tiers_catalog`
Expected: PASS

**Step 5: Commit**

```bash
```

---

### Task 3: Skill-creator 自举任务 + 任务队列

**Files:**
- Modify: `session-b-api/app/tree_api.py`
- Modify: `session-c-dispatch/app/main.py`
- Create: `session-b-api/tests/test_skill_bootstrap.py`

**Step 1: Write the failing test**

```python
    # 1) create run
    # 2) POST /skills/bootstrap with spec
    # 3) assert redis stream payload
    assert True
```

**Step 2: Run test to verify it fails**

Run: `cd api-backend && .venv/bin/python -m pytest -q tests/test_skill_bootstrap.py::test_skill_bootstrap_enqueues`
Expected: FAIL

**Step 3: Write minimal implementation**

```python
# session-b-api/app/tree_api.py
@router.post("/api/runs/{run_id}/agents/{agent_id}/skills/bootstrap")
async def bootstrap_skill(...):
    # enqueue to redis stream queue:skill-create
```

```python
# session-c-dispatch/app/main.py
# add consumer loop for queue:skill-create
# call skill-gateway /skills/create
# post event skill.create.succeeded/failed
```

**Step 4: Run test to verify it passes**

Run: `cd api-backend && .venv/bin/python -m pytest -q tests/test_skill_bootstrap.py::test_skill_bootstrap_enqueues`
Expected: PASS

**Step 5: Commit**

```bash
```

---

### Task 4: Docker 沙箱执行器（skill-gateway）

**Files:**
- Create: `skill-gateway/app/main.py`
- Create: `skill-gateway/requirements.txt`
- Create: `skill-gateway/AGENTS.md`
- Modify: `docker-compose.yml`
- Create: `skill-gateway/tests/test_health.py`

**Step 1: Write the failing test**

```python
def test_health():
    # GET /health returns ok
    assert True
```

**Step 2: Run test to verify it fails**

Run: `cd skill-gateway && .venv/bin/python -m pytest -q`
Expected: FAIL

**Step 3: Write minimal implementation**

```python
# skill-gateway/app/main.py
@app.post("/skills/create")
@app.post("/skills/execute")
# run docker container with SKILL_RUNNER_IMAGE, sandbox limits, remove container after
```

```yaml
# docker-compose.yml
skill-gateway:
  build: ./skill-gateway
  environment:
    - INTERNAL_API_KEY=...
    - SKILL_RUNNER_IMAGE=...
```

**Step 4: Run test to verify it passes**

Run: `cd skill-gateway && .venv/bin/python -m pytest -q`
Expected: PASS

**Step 5: Commit**

```bash
```

---

### Task 5: 技能自动执行队列（调用不依赖前端点击）

**Files:**
- Modify: `session-b-api/app/tree_api.py`
- Modify: `session-c-dispatch/app/main.py`
- Create: `session-b-api/tests/test_skill_invoke.py`

**Step 1: Write the failing test**

```python
    # POST /skills/{skill_key}/invoke
    # assert redis stream payload
    assert True
```

**Step 2: Run test to verify it fails**

Run: `cd api-backend && .venv/bin/python -m pytest -q tests/test_skill_invoke.py::test_skill_invoke_enqueues`
Expected: FAIL

**Step 3: Write minimal implementation**

```python
# session-b-api/app/tree_api.py
@router.post("/api/runs/{run_id}/agents/{agent_id}/skills/{skill_key}/invoke")
async def invoke_skill(...):
    # enqueue to queue:skill-exec
```

```python
# session-c-dispatch/app/main.py
# add consumer loop for queue:skill-exec
# call skill-gateway /skills/execute
# post event skill.execute.succeeded/failed
```

**Step 4: Run test to verify it passes**

Run: `cd api-backend && .venv/bin/python -m pytest -q tests/test_skill_invoke.py::test_skill_invoke_enqueues`
Expected: PASS

**Step 5: Commit**

```bash
```

---

### Task 6: 前端搜索 + NL 安装 + 自动执行提示

**Files:**
- Modify: `session-f-edge-ui/web-frontend/index.html`
- Modify: `session-f-edge-ui/web-frontend/app.js`
- Modify: `session-f-edge-ui/web-frontend/style.css`
- Modify: `session-f-edge-ui/web-frontend/README.md`

**Step 1: Write the failing test (manual check)**

```markdown
- [ ] Skills 区域支持搜索
- [ ] 输入自然语言 -> 自动安装
- [ ] 无需“调用”按钮
```

**Step 2: Run manual check to verify it fails**

Run: `docker compose up -d web-frontend gateway edge`
Expected: UI 无搜索/NL 安装

**Step 3: Write minimal implementation**

```html
<input id="task-skill-search" />
<button id="task-skill-install-nl">Install by NL</button>
```

```javascript
async function searchCommunitySkills(query) { ... }
async function installSkillByNl(query) { ... }
```

**Step 4: Run manual check to verify it passes**

Run: `docker compose up -d web-frontend gateway edge`
Expected: 搜索 + NL 安装可用

**Step 5: Commit**

```bash
```

---

### Task 7: 团队架构导出/导入（YAML）

**Files:**
- Modify: `session-b-api/requirements.txt`
- Modify: `session-b-api/app/agent_hiring.py`
- Modify: `session-b-api/app/tree_api.py`
- Create: `session-b-api/tests/test_team_templates.py`

**Step 1: Write the failing test**

```python
def test_team_export_import_yaml(tmp_path, monkeypatch):
    # 1) create run
    # 2) GET export -> YAML contains agents/edges
    # 3) POST import -> new run created
    # 4) GET tree for new run -> matches template structure
    assert True
```

**Step 2: Run test to verify it fails**

Run: `cd api-backend && .venv/bin/python -m pytest -q tests/test_team_templates.py::test_team_export_import_yaml`
Expected: FAIL (endpoint not found)

**Step 3: Write minimal implementation**

```text
# session-b-api/requirements.txt
PyYAML>=6.0,<7
```

```python
# session-b-api/app/agent_hiring.py
def hire_team_from_template(session: Session, *, tenant_id: int, run_id: int, template: dict[str, object]) -> int: ...
```

```python
# session-b-api/app/tree_api.py
@router.get("/api/runs/{run_id}/team/export")
async def export_team_yaml(...):
    # build template from AgentInstance + edges, return YAML

@router.post("/api/runs/team/import")
async def import_team_yaml(...):
    # create new run, hire_team_from_template, return run_id
```

**Schema (YAML 示例):**

```yaml
version: 1
name: example-team
agents:
  - id: lead
    role: lead
    sop: "# Lead SOP\n..."
  - id: pm
    role: pm
    parent: lead
    sop: "# PM SOP\n..."
  - id: engineer
    role: engineer
    parent: lead
    sop: "# Engineer SOP\n..."
```

**Step 4: Run test to verify it passes**

Run: `cd api-backend && .venv/bin/python -m pytest -q tests/test_team_templates.py::test_team_export_import_yaml`
Expected: PASS

**Step 5: Commit**

```bash
```

---

### Task 8: 多端协同（移动端基础查看 + 轻量干预）

**Files:**
- Modify: `session-f-edge-ui/web-frontend/index.html`
- Modify: `session-f-edge-ui/web-frontend/app.js`
- Modify: `session-f-edge-ui/web-frontend/style.css`
- Modify: `session-f-edge-ui/web-frontend/README.md`

**Step 1: Write the failing test (manual check)**

```markdown
- [ ] 手机端能查看任务树与节点状态
- [ ] 手机端保留 Pause/Resume/Retry 与自然语言干预入口
- [ ] 细节面板不遮挡主列表，重要状态可快速回看
```

**Step 2: Run manual check to verify it fails**

Run: `docker compose up -d web-frontend gateway edge`
Expected: 手机端交互不完整或遮挡

**Step 3: Write minimal implementation**

```html
<!-- session-f-edge-ui/web-frontend/index.html -->
<section class="task-mobile-toolbar"> ... </section>
```

```javascript
// session-f-edge-ui/web-frontend/app.js
function applyMobileLayout() { ... }
```

```css
/* session-f-edge-ui/web-frontend/style.css */
@media (max-width: 768px) {
  /* reduce panel width, keep tree visible, sticky actions */
}
```

**Step 4: Run manual check to verify it passes**

Run: `docker compose up -d web-frontend gateway edge`
Expected: 手机端可查看状态并触发轻量干预

**Step 5: Commit**

```bash
```

---

### Task 9: 文档与 AGENTS 更新 + 服务测试

**Files:**
- Modify: `session-a-docs/prd/2026-02-26-lingban-prd-v3.0.md`
- Modify: `session-a-docs/agent-framework.md`
- Modify: `session-b-api/AGENTS.md`
- Modify: `session-c-dispatch/AGENTS.md`
- Modify: `skill-gateway/AGENTS.md`
- Modify: `session-f-edge-ui/web-frontend/AGENTS.md`

**Step 1: Run service tests**

Run: `cd session-b-api && .venv/bin/python -m pytest -q`
Expected: PASS

Run: `cd session-c-dispatch && .venv/bin/python -m pytest -q`
Expected: PASS

Run: `cd skill-gateway && .venv/bin/python -m pytest -q`
Expected: PASS

**Step 2: Update AGENTS notes**

```markdown
- YYYY-MM-DD: Added skill search/NL install, skill-creator queue, skill sandbox executor.
```

**Step 3: Commit**

```bash
```
