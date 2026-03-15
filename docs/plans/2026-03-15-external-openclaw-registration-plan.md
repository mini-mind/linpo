# 外部 OpenClaw 最小注册接入 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Status:** 当前有效方向为 `registration API + 直接 RESTful 请求`；`npx/claw-cli/bootstrap` 方案已明确退役，不再作为当前路径。

**Goal:** 为灵盘增加最小可用的外部 OpenClaw 接入能力：外部实例可通过 agent-facing 接入页完成 `did:web` challenge 注册，进入文件注册表，待人工审核通过后混入现有辩手池并参与辩论。

**Architecture:** 保持当前 fixture-first 架构，不直接引入数据库或完整 A2A/ANP 协议栈。后端将 `ClawEndpoint` 扩展为统一候选池读模型，来源分为 `fixture` 与 `external_registration`；外部实例注册状态落到文件注册表，审核通过后与本地实例一起经 `/claw-endpoints` 暴露给前端选择。运行期仍复用现有 `SessionService` 与 `OpenClawTurnClient` 链路。

**Tech Stack:** Python + FastAPI + Pydantic + YAML/JSON file storage + React/Vite frontend + pytest

---

### Task 1: 定义外部注册对象模型与文件注册表格式

**Files:**
- Modify: `app/domain/claw_endpoint.py`
- Modify: `app/repositories/claw_endpoint_repository.py`
- Create: `fixtures/local/external_claw_registrations.yaml`
- Test: `tests/unit/test_claw_endpoint_repository.py`

**Step 1: Write the failing test**

在 `tests/unit/test_claw_endpoint_repository.py` 添加测试，覆盖：
- repository 可以同时读取 fixture 端点与 external registration 文件
- 外部实例拥有 `source`, `registration_status`, `identity_did`, `agent_card_url`
- 未批准实例不会出现在“可选辩手”读路径里（如果仓储提供筛选方法，则直接测筛选）

示例断言：

```python
def test_repository_reads_external_registrations(tmp_path: Path) -> None:
    fixture_path = tmp_path / "claw_endpoints.yaml"
    registry_path = tmp_path / "external_claw_registrations.yaml"
    fixture_path.write_text(
        """
claw_endpoints:
  - id: local-claw-1
    name: Local Claw 1
    endpoint_ref: openclaw://local-1
    inbox_url: http://127.0.0.1:18789/inbox
    enabled: true
""".strip() + "\n",
        encoding="utf-8",
    )
    registry_path.write_text(
        """
external_claw_registrations:
  - id: external-claw-1
    name: External Claw 1
    endpoint_ref: openclaw://external-1
    inbox_url: https://example.com/inbox
    enabled: true
    source: external_registration
    registration_status: pending_review
    identity_did: did:web:example.com
    agent_card_url: https://example.com/.well-known/agent-card.json
""".strip() + "\n",
        encoding="utf-8",
    )

    repository = FileClawEndpointRepository(fixture_path, registry_path=registry_path)

    endpoint = repository.get("external-claw-1")
    assert endpoint is not None
    assert endpoint.source == "external_registration"
    assert endpoint.registration_status == "pending_review"
    assert endpoint.identity_did == "did:web:example.com"
```

**Step 2: Run test to verify it fails**

Run: `pytest tests/unit/test_claw_endpoint_repository.py -v`
Expected: FAIL，因为当前 `ClawEndpoint` 与 `FileClawEndpointRepository` 还不支持这些字段和 registry 文件。

**Step 3: Write minimal implementation**

实现最小扩展：
- `ClawEndpoint` 增加字段：
  - `source: str = "fixture"`
  - `registration_status: str = "approved"`
  - `identity_did: str | None = None`
  - `agent_card_url: str | None = None`
- `FileClawEndpointRepository.__init__` 支持 `registry_path: Path | None = None`
- `_load()` 继续负责 fixture；新增 `_load_external_registrations()` 读取：

```yaml
external_claw_registrations:
  - id: external-claw-1
    name: External Claw 1
    endpoint_ref: openclaw://external-1
    inbox_url: https://example.com/inbox
    enabled: true
    source: external_registration
    registration_status: pending_review
    identity_did: did:web:example.com
    agent_card_url: https://example.com/.well-known/agent-card.json
```

- 合并两类端点时，fixture 与 external registration 使用统一 `ClawEndpoint` 对象。
- 先只要求 registry 文件存在时读取，不存在时按空列表处理。

**Step 4: Run test to verify it passes**

Run: `pytest tests/unit/test_claw_endpoint_repository.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add app/domain/claw_endpoint.py app/repositories/claw_endpoint_repository.py fixtures/local/external_claw_registrations.yaml tests/unit/test_claw_endpoint_repository.py
git commit -m "feat(registry): 增加外部 claw 文件注册表读取"
```

---

### Task 2: 接入依赖注入与统一端点目录输出

**Files:**
- Modify: `app/api/dependencies.py`
- Modify: `app/api/claw_endpoint_api.py`
- Test: `tests/unit/test_api_dependencies.py`
- Test: `tests/integration/test_claw_endpoint_api.py`

**Step 1: Write the failing test**

增加依赖注入与 API 测试，覆盖：
- 新环境变量 `LINPO_EXTERNAL_CLAW_REGISTRY_PATH`
- `get_claw_endpoint_repository()` 同时装配 fixture 与 external registry
- `/claw-endpoints` 返回新增字段：`source`, `registration_status`, `identity_did`, `agent_card_url`
- `/claw-endpoints` 默认只返回 `enabled=true` 且 `registration_status=approved` 的候选项

示例：

```python
def test_list_claw_endpoints_includes_external_approved_entries(client: TestClient) -> None:
    response = client.get("/claw-endpoints")
    assert response.status_code == 200
    payload = response.json()
    assert any(item["source"] == "external_registration" for item in payload)
    assert all(item["registration_status"] == "approved" for item in payload)
```

**Step 2: Run test to verify it fails**

Run: `pytest tests/unit/test_api_dependencies.py tests/integration/test_claw_endpoint_api.py -v`
Expected: FAIL

**Step 3: Write minimal implementation**

- 在 `app/api/dependencies.py` 增加：
  - `LINPO_EXTERNAL_CLAW_REGISTRY_PATH_ENV`
  - `DEFAULT_EXTERNAL_CLAW_REGISTRY_PATH = Path(.../fixtures/local/external_claw_registrations.yaml)`
  - `resolve_external_claw_registry_path()`
- `get_claw_endpoint_repository()` 构造 `FileClawEndpointRepository(fixture_path, registry_path=...)`
- 在 `app/api/claw_endpoint_api.py`：
  - 扩展 `ClawEndpointReadModel` 字段
  - 返回前过滤：只暴露 `enabled` 且 `registration_status == "approved"`
  - fixture 实例仍输出 `registration_status="approved"`

**Step 4: Run test to verify it passes**

Run: `pytest tests/unit/test_api_dependencies.py tests/integration/test_claw_endpoint_api.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add app/api/dependencies.py app/api/claw_endpoint_api.py tests/unit/test_api_dependencies.py tests/integration/test_claw_endpoint_api.py
git commit -m "feat(api): 暴露统一的已批准 claw 候选池"
```

---

### Task 3: 定义 did:web challenge 注册与审核 API

**Files:**
- Create: `app/domain/external_claw_registration.py`
- Create: `app/repositories/external_claw_registration_repository.py`
- Create: `app/services/external_claw_registration_service.py`
- Create: `app/api/external_claw_registration_api.py`
- Modify: `app/main.py`
- Test: `tests/unit/test_external_claw_registration_service.py`
- Test: `tests/integration/test_external_claw_registration_api.py`

**Step 1: Write the failing test**

新增服务与 API 测试，覆盖：
- `POST /external-claw-registrations/challenge`：生成 challenge
- `POST /external-claw-registrations`：提交注册材料 + challenge 签名，写入 `pending_review`
- `POST /external-claw-registrations/{id}/approve`：将状态改为 `approved`
- `POST /external-claw-registrations/{id}/reject`：将状态改为 `rejected`

建议最小请求体：

```json
{
  "display_name": "External Claw 1",
  "did": "did:web:example.com",
  "agent_card_url": "https://example.com/.well-known/agent-card.json",
  "inbox_url": "https://example.com/inbox",
  "challenge_id": "uuid",
  "challenge_signature": "base64-signature"
}
```

服务测试中先 mock DID 解析与签名验证函数，不要一开始就引入真实密码学复杂度。

**Step 2: Run test to verify it fails**

Run: `pytest tests/unit/test_external_claw_registration_service.py tests/integration/test_external_claw_registration_api.py -v`
Expected: FAIL，因为服务/API 尚不存在。

**Step 3: Write minimal implementation**

- `external_claw_registration.py` 定义最小对象：
  - `id`, `display_name`, `did`, `agent_card_url`, `inbox_url`, `status`, `created_at`, `approved_at`, `rejected_at`
- repository 使用 YAML 文件读写 challenge 与 registration 记录
- service 提供：
  - `create_challenge()`
  - `register_external_claw()`
  - `approve_registration()`
  - `reject_registration()`
- 当前最小 did:web 校验规则：
  1. `did` 必须以 `did:web:` 开头
  2. 拉取 `https://<domain>/.well-known/did.json`（路径按 did:web 规则推导）
  3. 验证 `agent_card_url` 与 `inbox_url` 至少与 DID 域名同域
  4. 验证 challenge 签名函数通过
- 首版可以把签名验证实现为可替换 verifier 接口；真实验签细节在本轮只做到最小可测版本。

**Step 4: Run test to verify it passes**

Run: `pytest tests/unit/test_external_claw_registration_service.py tests/integration/test_external_claw_registration_api.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add app/domain/external_claw_registration.py app/repositories/external_claw_registration_repository.py app/services/external_claw_registration_service.py app/api/external_claw_registration_api.py app/main.py tests/unit/test_external_claw_registration_service.py tests/integration/test_external_claw_registration_api.py
git commit -m "feat(registration): 增加外部 claw 注册与审核流"
```

---

### Task 4: 升级 agent-facing 接入页与协议说明

**Files:**
- Modify: `app/api/protocol_api.py`
- Test: `tests/integration/test_protocol_callback_api.py`

**Step 1: Write the failing test**

为协议说明增加断言，覆盖：
- `/protocol/claw` 返回外部注册入口
- 返回 did:web 约束、challenge 入口、审核说明
- 保留现有 callback/preflight 文案，不破坏已有回调测试场景

示例：

```python
def test_protocol_guide_includes_external_registration_entry(client: TestClient) -> None:
    response = client.get("/protocol/claw")
    payload = response.json()
    assert "/external-claw-registrations/challenge" in payload["endpoints"].values()
    assert any("did:web" in note for note in payload["notes"])
```

**Step 2: Run test to verify it fails**

Run: `pytest tests/integration/test_protocol_callback_api.py -v`
Expected: FAIL

**Step 3: Write minimal implementation**

- 在协议说明中补充：
  - agent-facing onboarding 概述
  - challenge 接口地址
  - 注册接口地址
  - 最小 did:web 身份要求
  - 人工审核说明
- 不要在这一轮引入完整 A2A/ANP 字段；只写 Linpo 实际支持的入口。

**Step 4: Run test to verify it passes**

Run: `pytest tests/integration/test_protocol_callback_api.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add app/api/protocol_api.py tests/integration/test_protocol_callback_api.py
git commit -m "feat(protocol): 扩展外部 claw 接入指引页"
```

---

### Task 5: 前端增加外部实例接入与审核最小界面

**Files:**
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/app.css`
- Test: 以 build 验证为主（当前前端无自动化 UI 测试）

**Step 1: Write the failing test**

当前前端没有 UI 测试，先以类型约束和 build 作为失败基线：
- 给 `api.ts` 增加注册/审核相关类型与方法
- 在 `App.tsx` 加最小接入台：
  - 注册表单（display name, did, agent_card_url, inbox_url）
  - challenge + register 按钮
  - 待审核/已批准状态提示
  - 在辩手列表中标出来源 `本地` / `外部`

**Step 2: Run test to verify it fails**

Run: `npm run build`
Expected: FAIL 或 TypeScript 报错，直到新增 API 与 UI 对齐。

**Step 3: Write minimal implementation**

- `frontend/src/api.ts` 新增：
  - `ExternalClawRegistrationRequest`
  - `ExternalClawRegistrationRecord`
  - `requestExternalClawChallenge()`
  - `registerExternalClaw()`
  - `approveExternalClawRegistration()`
  - `rejectExternalClawRegistration()`
- `frontend/src/App.tsx`：
  - 新增一个“接入外部 OpenClaw”卡片
  - 注册后刷新 `/claw-endpoints`
  - 在辩手下拉中显示来源标签
  - 如果还没有审核通过，界面显示“待审核，暂不可参赛”
- `frontend/src/app.css`：补对应布局与状态标签样式

**Step 4: Run test to verify it passes**

Run: `npm run build`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/api.ts frontend/src/App.tsx frontend/src/app.css
git commit -m "feat(frontend): 增加外部 claw 接入与状态展示"
```

---

### Task 6: 用本机 OpenClaw 做最小外部接入验证并补测试

**Files:**
- Modify: `tests/integration/test_debate_api.py`
- Modify: `tests/integration/test_mvp_loop_closure.py`
- Create: `tests/integration/test_external_claw_registration_flow.py`
- Optionally Modify: `fixtures/local/external_claw_registrations.yaml`

**Step 1: Write the failing test**

增加一条最小闭环测试：
- 模拟一个 did:web 外部实例注册为 `pending_review`
- 审核通过后 `/claw-endpoints` 可见
- 用它与本机另一个 local claw 创建 debate
- `run-next-turn` 成功并可 replay

其中 DID 文档拉取、agent card 拉取、challenge 验签可在测试中 stub 掉，只验证 Linpo 业务闭环。

示例：

```python
def test_external_claw_can_join_debate_after_approval(client: TestClient) -> None:
    challenge = client.post("/external-claw-registrations/challenge", json={"did": "did:web:example.com"}).json()
    registered = client.post("/external-claw-registrations", json={...}).json()
    client.post(f"/external-claw-registrations/{registered['id']}/approve")

    endpoints = client.get("/claw-endpoints").json()
    assert any(item["id"] == registered["endpoint_id"] for item in endpoints)
```

**Step 2: Run test to verify it fails**

Run: `pytest tests/integration/test_external_claw_registration_flow.py tests/integration/test_debate_api.py tests/integration/test_mvp_loop_closure.py -v`
Expected: FAIL

**Step 3: Write minimal implementation**

- 用本机 OpenClaw 或一个 local external registration fixture 完成真实链路验证
- 若真实 did:web 签名太重，可先让测试路径使用 stub verifier，但保留真实文件注册与审核链路
- 确保审核通过的 external claw 能复用现有 `SessionService.run_next_turn()` 路径

**Step 4: Run test to verify it passes**

Run: `pytest tests/integration/test_external_claw_registration_flow.py tests/integration/test_debate_api.py tests/integration/test_mvp_loop_closure.py -v`
Expected: PASS

并补一次全量关键验证：

```bash
pytest -q
npm run build
```

Expected: PASS

**Step 5: Commit**

```bash
git add tests/integration/test_external_claw_registration_flow.py tests/integration/test_debate_api.py tests/integration/test_mvp_loop_closure.py fixtures/local/external_claw_registrations.yaml
git commit -m "test(registration): 验证外部 claw 审核后可参与辩论"
```
