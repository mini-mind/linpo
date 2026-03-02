# PRD v3 P1 Skill 生态与团队复用 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 落地 PRD v3 P1：Skill 自举（初版）、社区技能安装（初版）、团队架构导出/导入（YAML）、移动端基础查看与轻量干预。

**Architecture:** 以 api 提供最小可用 API（技能清单、技能安装、团队导出/导入），数据落盘到 agent FS；web-frontend 提供对应 UI 与基础移动端体验。导出/导入使用 YAML（引入 PyYAML），导入时基于模板创建一条新的 run 与 agent 树。

**Tech Stack:** FastAPI, SQLAlchemy, pytest, PyYAML, vanilla JS/CSS/HTML

---

### Task 1: Skill 自举（API + FS 落盘）

**Files:**
- Modify: `api/app/agent_fs.py`
- Modify: `api/tests/test_agent_fs.py`
- Modify: `api/app/tree_api.py`
- Create: `api/tests/test_agent_skills.py`

**Step 1: Write the failing test**

```python
def test_agent_skills_roundtrip(tmp_path, monkeypatch):
    # 1) create run
    # 2) PUT skills -> expect 200 with normalized list
    # 3) GET skills -> same list
    # 4) verify skills/*.py files exist
    assert True
```

**Step 2: Run test to verify it fails**

Run: `cd api && .venv/bin/python -m pytest -q tests/test_agent_skills.py::test_agent_skills_roundtrip`

Expected: FAIL (endpoint not found)

**Step 3: Write minimal implementation**

```python
# api/app/agent_fs.py
def read_skills_manifest(agent_root: Path) -> list[dict[str, str]]: ...
def write_skills_manifest(agent_root: Path, skills: list[dict[str, str]]) -> None: ...
def write_skill_code(agent_root: Path, filename: str, code: str) -> None: ...
```

```python
# api/app/agent_fs.py
# ensure_agent_layout 增加 skills 目录
```

```python
# api/app/tree_api.py
@router.get("/api/runs/{run_id}/agents/{agent_id}/skills")
async def get_agent_skills(...):
    # return manifest list

@router.put("/api/runs/{run_id}/agents/{agent_id}/skills")
async def put_agent_skills(...):
    # validate names + filenames, write code files + manifest
```

**Step 4: Run test to verify it passes**

Run: `cd api && .venv/bin/python -m pytest -q tests/test_agent_skills.py::test_agent_skills_roundtrip`

Expected: PASS

**Step 5: Commit**

```bash
git add api/app/agent_fs.py api/app/tree_api.py api/tests/test_agent_skills.py
git commit -m "feat: add agent skills manifest api"
```

---

### Task 2: 社区技能安装（本地注册表 + 安装 API）

**Files:**
- Create: `config/community_skills.yaml`
- Create: `community_skills/hello_world.py`
- Modify: `api/app/config_loader.py`
- Modify: `api/app/tree_api.py`
- Create: `api/tests/test_community_skills.py`

**Step 1: Write the failing test**

```python
def test_install_community_skill(tmp_path, monkeypatch):
    # 1) create run
    # 2) POST install with skill_key
    # 3) GET skills -> includes installed
    # 4) file written under skills/
    assert True
```

**Step 2: Run test to verify it fails**

Run: `cd api && .venv/bin/python -m pytest -q tests/test_community_skills.py::test_install_community_skill`

Expected: FAIL (endpoint not found)

**Step 3: Write minimal implementation**

```yaml
# config/community_skills.yaml
skills:
  - key: hello_world
    name: Hello World
    filename: hello_world.py
    description: Sample community skill
```

```python
# api/app/config_loader.py
def load_community_skills() -> list[dict[str, str]]: ...
```

```python
# api/app/tree_api.py
@router.post("/api/runs/{run_id}/agents/{agent_id}/skills/install")
async def install_community_skill(...):
    # lookup skill by key, copy file into agent skills/, update manifest

@router.get("/api/community-skills")
async def list_community_skills(...):
    # return skills from YAML registry
```

**Step 4: Run test to verify it passes**

Run: `cd api && .venv/bin/python -m pytest -q tests/test_community_skills.py::test_install_community_skill`

Expected: PASS

**Step 5: Commit**

```bash
git add config/community_skills.yaml community_skills/hello_world.py api/app/config_loader.py api/app/tree_api.py api/tests/test_community_skills.py
git commit -m "feat: add community skill install"
```

---

### Task 3: 团队架构导出/导入（YAML）

**Files:**
- Modify: `api/requirements.txt`
- Modify: `api/app/agent_hiring.py`
- Modify: `api/app/tree_api.py`
- Create: `api/tests/test_team_templates.py`

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

Run: `cd api && .venv/bin/python -m pytest -q tests/test_team_templates.py::test_team_export_import_yaml`

Expected: FAIL (endpoint not found)

**Step 3: Write minimal implementation**

```text
# api/requirements.txt
PyYAML>=6.0,<7
```

```python
# api/app/agent_hiring.py
def hire_team_from_template(session: Session, *, tenant_id: int, run_id: int, template: dict[str, object]) -> int: ...
```

```python
# api/app/tree_api.py
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

Run: `cd api && .venv/bin/python -m pytest -q tests/test_team_templates.py::test_team_export_import_yaml`

Expected: PASS

**Step 5: Commit**

```bash
git add api/requirements.txt api/app/agent_hiring.py api/app/tree_api.py api/tests/test_team_templates.py
git commit -m "feat: add team export/import yaml"
```

---

### Task 4: 前端技能与导入/导出 UI（含移动端轻量流程）

**Files:**
- Modify: `edge-ui/web-frontend/index.html`
- Modify: `edge-ui/web-frontend/app.js`
- Modify: `edge-ui/web-frontend/style.css`
- Modify: `edge-ui/web-frontend/README.md`

**Step 1: Write the failing test (manual check)**

Add checklist in README:

```markdown
- [ ] 任务详情显示 Skills 面板（列表 + 安装按钮）
- [ ] 支持导出 YAML 文件
- [ ] 支持粘贴 YAML 导入并创建新 run
- [ ] 手机端能查看状态/控制/Skills（不挡住主列表），仅保留 Pause/Resume/Retry 与安装按钮
```

**Step 2: Run manual check to verify it fails**

Run: `docker compose up -d web-frontend gateway edge`

Expected: UI 无 Skills 面板与导入/导出按钮

**Step 3: Write minimal implementation**

```html
<!-- edge-ui/web-frontend/index.html -->
<section class="task-skills-section"> ... </section>
<section class="task-export-section"> ... </section>
```

```javascript
// edge-ui/web-frontend/app.js
async function loadSkills(runId, agentId) { ... }
async function installCommunitySkill(runId, agentId, skillKey) { ... }
async function exportTeamYaml(runId) { ... }
async function importTeamYaml(yamlText) { ... }
```

```css
/* edge-ui/web-frontend/style.css */
@media (max-width: 768px) { /* keep details panel usable */ }
```

**Step 4: Run manual check to verify it passes**

Run: `docker compose up -d web-frontend gateway edge`

Expected: Skills + 导入/导出 UI 可用，手机端能查看并触发轻量操作

**Step 5: Commit**

```bash
git add edge-ui/web-frontend/index.html edge-ui/web-frontend/app.js edge-ui/web-frontend/style.css edge-ui/web-frontend/README.md
git commit -m "feat: add skills and team import/export ui"
```

---

### Task 5: 服务验证与文档更新

**Files:**
- Modify: `api/AGENTS.md`
- Modify: `edge-ui/web-frontend/AGENTS.md`
- Modify: `docs/agent-framework.md`

**Step 1: Run service tests**

Run: `cd api && .venv/bin/python -m pytest -q`

Expected: PASS

**Step 2: Update AGENTS notes**

```markdown
- YYYY-MM-DD: Added skill manifest + community install + team export/import YAML.
```

**Step 3: Commit**

```bash
git add api/AGENTS.md edge-ui/web-frontend/AGENTS.md docs/agent-framework.md
git commit -m "docs: note P1 skills and team export/import"
```
