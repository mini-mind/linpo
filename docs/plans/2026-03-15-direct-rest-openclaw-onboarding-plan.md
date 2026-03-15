# 直接 RESTful 外部 OpenClaw 接入实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 完善外部 OpenClaw 直接通过 REST API 接入灵盘所需的最小工作：补充 agent-facing REST 接入指南与示例、对齐前端高级入口、验证端到端闭环。

**Architecture:** 复用现有 `/external-claw-registrations` 系列 API，不引入新的 CLI/npx 工具。外部 OpenClaw 运维者直接使用 curl 或 HTTP 客户端完成 did:web challenge 注册流程。前端已有基础注册面板，需对齐产品入口定义中的"高级能力"定位。协议说明页已有注册入口，需补充具体 REST 示例。

**Tech Stack:** Python + FastAPI + Pydantic + YAML file storage + React/Vite frontend + pytest

---

## 现状评估

### 已完成

| 组件 | 状态 | 说明 |
|------|------|------|
| `POST /external-claw-registrations/challenge` | 已实现 | 生成 did:web challenge |
| `POST /external-claw-registrations` | 已实现 | 提交注册材料 + 签名验证 |
| `POST /external-claw-registrations/{id}/approve` | 已实现 | 人工批准 |
| `POST /external-claw-registrations/{id}/reject` | 已实现 | 拒绝注册 |
| 前端注册面板 | 已实现 | 可折叠的注册表单 |
| 协议说明页 | 已实现 | 已列出注册端点 |

### 待完成

| 任务 | 说明 |
|------|------|
| Agent-facing REST 接入指南 | 外部 OpenClaw 运维者需要清晰的 curl 示例与步骤说明 |
| 前端高级入口对齐 | 验证前端面板与产品定义一致，状态提示完整 |
| 端到端验证测试 | 确保直接 REST 调用可完成完整注册流 |

---

### Task 1: 补充 Agent-facing REST 接入指南与示例

**Files:**
- Modify: `app/api/protocol_api.py`
- Modify: `tests/integration/test_protocol_callback_api.py`

**Step 1: Write the failing test**

在 `tests/integration/test_protocol_callback_api.py` 添加测试，验证协议说明包含完整的 REST 接入步骤：

```python
def test_protocol_guide_includes_rest_onboarding_examples(client: TestClient) -> None:
    response = client.get("/protocol/claw")
    payload = response.json()
    
    # 验证端点存在
    assert "/external-claw-registrations/challenge" in payload["endpoints"].values()
    assert "/external-claw-registrations" in payload["endpoints"].values()
    
    # 验证包含 REST 示例说明
    notes = payload.get("notes", [])
    assert any("curl" in note.lower() or "REST" in note or "HTTP" in note for note in notes)
    
    # 验证包含步骤说明
    prerequisites = payload.get("prerequisites", [])
    assert len([p for p in prerequisites if "did:web" in p.lower()]) >= 1
```

**Step 2: Run test to verify it fails**

Run: `pytest tests/integration/test_protocol_callback_api.py -v`
Expected: FAIL - 当前 notes 未包含 curl 示例

**Step 3: Write minimal implementation**

在 `app/api/protocol_api.py` 的 `ProtocolGuideResponse` 中补充：

```python
@router.get("", response_model=ProtocolGuideResponse)
def protocol_claw() -> ProtocolGuideResponse:
    info = _protocol_info()
    return ProtocolGuideResponse(
        name="linpo claw protocol",
        version=info.version,
        endpoints=info.endpoints,
        auth={
            "type": info.auth["type"],
            "notes": "No authentication is required for this callback smoke test.",
        },
        task_types=info.task_types,
        prerequisites=[
            "For external onboarding, prepare a did:web identifier first.",
            "Step 1: POST /external-claw-registrations/challenge with {\"did\": \"did:web:yourdomain.com\"}",
            "Step 2: Sign the returned nonce with your DID private key.",
            "Step 3: POST /external-claw-registrations with display_name, did, agent_card_url, inbox_url, challenge_id, challenge_signature.",
            "Step 4: Wait for manual approval (status: pending_review -> approved).",
        ],
        callback_guidance=[
            "External OpenClaw onboarding uses direct REST calls, no CLI required.",
            "Use curl or any HTTP client to call the registration endpoints.",
            "Approved external claws appear in /claw-endpoints and can join debates.",
        ],
        error_responses={
            "400": "Invalid request: check did:web format, signature, or URL domain mismatch.",
            "404": "Registration not found when approving/rejecting.",
            "503": "Registration store unavailable.",
        },
        notes=[
            "DIRECT REST ONBOARDING EXAMPLE:",
            "",
            "# Step 1: Request challenge",
            'curl -X POST http://linpo.duckdns.org/external-claw-registrations/challenge \\',
            '  -H "Content-Type: application/json" \\',
            '  -d \'{"did": "did:web:example.com"}\'',
            "",
            "# Response: {\"id\": \"uuid\", \"did\": \"did:web:example.com\", \"nonce\": \"random-string\", \"created_at\": \"...\"}",
            "",
            "# Step 2: Sign the nonce with your DID private key (off-line)",
            "# The signature format depends on your DID document verification method",
            "",
            "# Step 3: Submit registration",
            'curl -X POST http://linpo.duckdns.org/external-claw-registrations \\',
            '  -H "Content-Type: application/json" \\',
            '  -d \'{"display_name": "My Claw", "did": "did:web:example.com", "agent_card_url": "https://example.com/.well-known/agent-card.json", "inbox_url": "https://example.com/inbox", "challenge_id": "uuid-from-step-1", "challenge_signature": "base64-signature"}\'',
            "",
            "# Response: {\"id\": \"reg-id\", \"status\": \"pending_review\", ...}",
            "",
            "# Step 4: Contact Linpo admin for approval",
            "# After approval, your claw appears in /claw-endpoints",
        ],
    )
```

**Step 4: Run test to verify it passes**

Run: `pytest tests/integration/test_protocol_callback_api.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add app/api/protocol_api.py tests/integration/test_protocol_callback_api.py
git commit -m "docs(protocol): 增加 agent-facing REST 接入指南与 curl 示例"
```

---

### Task 2: 前端高级入口对齐与状态完善

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/api.ts`
- Test: `npm run build`

**Step 1: Verify current state**

检查前端当前实现与产品定义 `docs/prd/2026-03-15-product-entry.md` 的对齐情况：

产品定义要求：
- 外部实例注册是**高级能力**，不占据主流程入口
- 位于左侧面板底部
- 默认折叠状态
- 注册后状态为「待审核」

当前实现检查点：
- 是否默认折叠：已实现（`showRegPanel` 状态）
- 是否在底部：需验证布局
- 状态提示是否完整：已显示「待审核，暂不可参赛」

**Step 2: Enhance status display**

在 `frontend/src/App.tsx` 中，增强注册成功后的状态反馈：

```tsx
// 在注册成功后，刷新 claw 列表以显示新注册的 claw
async function handleRegisterExternalClaw(event: FormEvent<HTMLFormElement>) {
  // ... existing validation ...
  
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
    // 刷新 claw 列表，显示新注册的 claw（带 pending_review 状态）
    await loadOverview();
  }
}
```

在 `frontend/src/App.tsx` 中，在辩手列表中显示注册状态的更详细信息：

```tsx
function formatSourceLabel(source: ClawEndpoint['source'], registrationStatus?: ClawEndpoint['registration_status']): string {
  if (source === 'external_registration') {
    if (registrationStatus === 'pending_review') {
      return '外部(待审核)';
    }
    if (registrationStatus === 'rejected') {
      return '外部(已拒绝)';
    }
    return '外部';
  }
  return '本地';
}
```

更新下拉选项显示：

```tsx
<option key={claw.id} value={claw.id}>
  {claw.name}（{formatSourceLabel(claw.source, claw.registration_status)}）
</option>
```

**Step 3: Run build to verify**

Run: `cd frontend && npm run build`
Expected: PASS

**Step 4: Commit**

```bash
git add frontend/src/App.tsx frontend/src/api.ts
git commit -m "feat(frontend): 增强外部 claw 注册状态显示与列表刷新"
```

---

### Task 3: 补充端到端直接 REST 验证测试

**Files:**
- Create: `tests/integration/test_direct_rest_onboarding_flow.py`

**Step 1: Write the failing test**

创建完整的 REST 接入流程测试：

```python
"""Tests for direct REST onboarding flow without CLI."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client_with_stubbed_verification(tmp_path: Path) -> TestClient:
    """Create test client with stubbed DID verification."""
    fixtures_path = tmp_path / "fixtures"
    fixtures_path.mkdir()
    
    claw_endpoints_file = fixtures_path / "claw_endpoints.yaml"
    claw_endpoints_file.write_text(
        """
fixture_scope: test
endpoint_ref_kind: openclaw_runtime_reference
claw_endpoints:
  - id: local-claw-1
    name: Local Claw 1
    endpoint_ref: openclaw://local-1
    inbox_url: http://127.0.0.1:18789/inbox
    enabled: true
""",
        encoding="utf-8",
    )
    
    registry_file = fixtures_path / "external_claw_registrations.yaml"
    registry_file.write_text(
        "external_claw_challenges: []\nexternal_claw_registrations: []\n",
        encoding="utf-8",
    )
    
    app = create_app(
        claw_endpoint_fixture_path=claw_endpoints_file,
        external_claw_registry_path=registry_file,
    )
    
    # Stub DID verification
    from app.api import dependencies
    original_resolver = dependencies.resolve_did_document
    original_verifier = dependencies.verify_challenge_signature
    
    dependencies.resolve_did_document = lambda did: {
        "id": did,
        "verificationMethod": [{"id": f"{did}#key-1", "type": "JsonWebKey"}],
    }
    dependencies.verify_challenge_signature = lambda **kwargs: True
    
    yield TestClient(app)
    
    dependencies.resolve_did_document = original_resolver
    dependencies.verify_challenge_signature = original_verifier


def test_direct_rest_challenge_request(client_with_stubbed_verification: TestClient) -> None:
    """Step 1: Request challenge via REST."""
    response = client_with_stubbed_verification.post(
        "/external-claw-registrations/challenge",
        json={"did": "did:web:example.com"},
    )
    assert response.status_code == 201
    payload = response.json()
    assert payload["did"] == "did:web:example.com"
    assert "id" in payload
    assert "nonce" in payload


def test_direct_rest_registration_flow(client_with_stubbed_verification: TestClient) -> None:
    """Complete REST onboarding flow: challenge -> register -> approve -> visible."""
    # Step 1: Get challenge
    challenge_response = client_with_stubbed_verification.post(
        "/external-claw-registrations/challenge",
        json={"did": "did:web:test.example.com"},
    )
    assert challenge_response.status_code == 201
    challenge = challenge_response.json()
    
    # Step 2: Submit registration
    registration_response = client_with_stubbed_verification.post(
        "/external-claw-registrations",
        json={
            "display_name": "Test External Claw",
            "did": "did:web:test.example.com",
            "agent_card_url": "https://test.example.com/.well-known/agent-card.json",
            "inbox_url": "https://test.example.com/inbox",
            "challenge_id": challenge["id"],
            "challenge_signature": "stub-signature",
        },
    )
    assert registration_response.status_code == 201
    registration = registration_response.json()
    assert registration["status"] == "pending_review"
    
    # Step 3: Before approval, should NOT appear in claw-endpoints
    endpoints_before = client_with_stubbed_verification.get("/claw-endpoints").json()
    assert not any(e["id"] == registration["id"] for e in endpoints_before)
    
    # Step 4: Approve registration
    approve_response = client_with_stubbed_verification.post(
        f"/external-claw-registrations/{registration['id']}/approve",
    )
    assert approve_response.status_code == 200
    approved = approve_response.json()
    assert approved["status"] == "approved"
    
    # Step 5: After approval, should appear in claw-endpoints
    endpoints_after = client_with_stubbed_verification.get("/claw-endpoints").json()
    matching = [e for e in endpoints_after if e["id"] == registration["id"]]
    assert len(matching) == 1
    assert matching[0]["source"] == "external_registration"
    assert matching[0]["registration_status"] == "approved"


def test_direct_rest_rejected_registration_not_visible(
    client_with_stubbed_verification: TestClient,
) -> None:
    """Rejected registration should not appear in claw-endpoints."""
    # Get challenge and register
    challenge = client_with_stubbed_verification.post(
        "/external-claw-registrations/challenge",
        json={"did": "did:web:rejected.example.com"},
    ).json()
    
    registration = client_with_stubbed_verification.post(
        "/external-claw-registrations",
        json={
            "display_name": "Rejected Claw",
            "did": "did:web:rejected.example.com",
            "agent_card_url": "https://rejected.example.com/agent-card.json",
            "inbox_url": "https://rejected.example.com/inbox",
            "challenge_id": challenge["id"],
            "challenge_signature": "stub-signature",
        },
    ).json()
    
    # Reject
    client_with_stubbed_verification.post(
        f"/external-claw-registrations/{registration['id']}/reject",
    )
    
    # Should NOT appear in claw-endpoints
    endpoints = client_with_stubbed_verification.get("/claw-endpoints").json()
    assert not any(e["id"] == registration["id"] for e in endpoints)
```

**Step 2: Run test to verify it fails**

Run: `pytest tests/integration/test_direct_rest_onboarding_flow.py -v`
Expected: FAIL - 测试文件尚未创建

**Step 3: Create the test file**

创建上述测试文件。

**Step 4: Run test to verify it passes**

Run: `pytest tests/integration/test_direct_rest_onboarding_flow.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/integration/test_direct_rest_onboarding_flow.py
git commit -m "test(onboarding): 增加直接 REST 接入端到端验证测试"
```

---

### Task 4: 全量回归验证

**Files:**
- No file changes, verification only

**Step 1: Run all tests**

```bash
pytest -q
```

Expected: All tests pass

**Step 2: Run frontend build**

```bash
cd frontend && npm run build
```

Expected: Build succeeds

**Step 3: Manual smoke test**

手动验证 REST 接入流程：
1. 启动后端服务
2. 访问 `/protocol/claw` 确认指南内容
3. 使用 curl 测试 challenge -> register 流程

---

## 验收标准

| 标准 | 验证方式 |
|------|----------|
| Agent-facing REST 指南完整 | `/protocol/claw` 返回 curl 示例 |
| 前端高级入口对齐 | 布局符合产品定义，状态显示完整 |
| 端到端 REST 流程可用 | `test_direct_rest_onboarding_flow.py` 通过 |
| 不引入 CLI/npx 依赖 | 无新增 CLI 相关代码 |
| 全量测试通过 | `pytest -q` 全绿 |

---

## 约束与边界

**不做：**
- 不引入 npx/CLI 工具
- 不扩展到平台管理后台
- 不假设持久化用户认证
- 不实现自动批准
- 不支持非 did:web 方法

**保留：**
- 现有 fixture-first 架构
- 文件注册表存储
- 人工审核流程
- 与本地实例混合展示的辩手池