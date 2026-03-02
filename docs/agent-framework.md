# Agent Framework Documentation

## 文档导航

- [文档中心](README.md) - 返回文档中心
- [Sisyphus 工作流](process/sisyphus-workflow.md) - 查看工作流文档

## Key Rules and Guidelines

### Configuration Separation

**YAML vs Markdown Separation:**
- YAML files (`config/*.yaml`) contain programmatic configuration and agent definitions
- Markdown files (`prompts/**/*.md`) contain human-readable prompts and descriptions
- Keep them separate: YAML is for the system to parse, MD is for humans to read

### LLM Gateway Architecture

**Platform-Level API Key Management:**

API keys are stored in a platform-private file outside tenant workspaces. The LLM Gateway service handles all LLM calls and keeps provider credentials secure.

**Gateway Configuration:**
1. Copy `config/llm-providers.example.json` to your platform's private location
   - Production: `/etc/web3d/llm-providers.json` (platform-admin only)
   - Development: `/run/secrets/llm-providers.json` (mounted as Docker secret)
2. Fill in your actual values:
   - `providers.ark-code-latest.base_url`: VolcEngine ARK endpoint URL
   - `providers.ark-code-latest.api_key`: Your VolcEngine ARK API key
3. The `llm-gateway` service loads this file at startup
4. **Never commit** the actual `llm-providers.json` file - it contains secrets

**Development (HK):**
For local development with the platform-private secrets file:
1. Create the directory: `mkdir -p /home/ravin/.web3d-secrets`
2. Store the real file at: `/home/ravin/.web3d-secrets/llm-providers.json`
3. Restart llm-gateway with the path override:
   ```bash
   LLM_PROVIDERS_HOST_PATH=/home/ravin/.web3d-secrets/llm-providers.json docker compose up -d --no-deps llm-gateway
   ```
**Important:** This file is platform-private, not in any tenant workspace, and must never be committed to version control.

**Example llm-providers.json:**
```json
{
  "providers": {
    "ark-code-latest": {
      "base_url": "https://ark.cn-beijing.volces.com/api/coding/v3",
      "api_key": "your-actual-api-key-here"
    }
  }
}
```

**Tenant/Agent Usage:**
- Tenants and agents never read API keys directly
- Agents select models by `model_ref` (e.g., "ark-code-latest")
- LLM calls go through the gateway's internal endpoint: `POST /internal/llm/chat`
- The gateway maps `model_ref` to the provider's `base_url` and `api_key`
- This enables centralized key management and multi-tenant isolation

**Gateway API Endpoint:**
```
POST /internal/llm/chat
Headers:
  X-Internal-Key: <INTERNAL_API_KEY>

Body:
{
  "model": "ark-code-latest",
  "messages": [
    {"role": "user", "content": "hello"}
  ],
  "temperature": 0.2,
  "max_tokens": 512
}
```

### Security Guidelines

**Never Commit Secrets:**
- API keys are stored in platform-private `llm-providers.json` (outside tenant workspaces)
- `config/llm-providers.example.json` is tracked but contains placeholders only
- Rotate API keys regularly (quarterly minimum)
- Do not log secrets in application logs
- Use Docker Secrets or mounted files for production credentials

**Secret Rotation Process (LLM Gateway):**
1. Generate new API key from your provider (VolcEngine ARK)
2. Update the platform-private `llm-providers.json` file
3. Restart the `llm-gateway` service to load the updated configuration
4. Test with LLM calls to verify the new key works
5. Revoke old key after successful deployment

### 自然语言干预（Intervention）

**事件驱动干预：**
- 通过 `POST /api/runs/{run_id}/interventions` 提交干预
- 干预会生成 `task.requires_input` 事件并广播到 `/ws/runs/{run_id}`
- 干预消息用于调整目标、计划或执行策略

### 可信来源（Sources）

**来源绑定 API：**
- `GET /api/runs/{run_id}/agents/{agent_id}/sources` 获取来源列表
- `PUT /api/runs/{run_id}/agents/{agent_id}/sources` 更新来源列表
- 来源清单写入 agent FS 的 `context/sources/manifest.json`

### 控制动作（Pause/Resume/Retry）

**控制动作 API：**
- `POST /api/runs/{run_id}/actions` 提交控制动作
- `action_type` 支持 `run.pause` / `run.resume` / `run.retry`
- 生成 `action.requested` 事件并广播到 `/ws/runs/{run_id}`

### 技能清单与社区技能

**Agent 技能 API：**
- `GET /api/runs/{run_id}/agents/{agent_id}/skills` 获取技能清单
- `PUT /api/runs/{run_id}/agents/{agent_id}/skills` 覆盖技能清单（写入 `agent_fs/skills/*.py` + `manifest.json`）

**社区技能 API：**
- `GET /api/community-skills` 获取社区技能注册表（来自 `config/community_skills.yaml`）
- `POST /api/runs/{run_id}/agents/{agent_id}/skills/install` 安装指定技能

### 团队导出/导入（YAML）

**模板 API：**
- `GET /api/runs/{run_id}/team/export` 导出 YAML
- `POST /api/runs/team/import` 导入 YAML 并创建新 run

**术语说明：** 产品语境中的 SOP 指 TODO/计划列表，来源为 `plan.md` 并解析为 `plan_subtasks`。当前实现仍保留 SOP 模板（`sops/templates/*.md` + `mission.md` + `/api/agents/{agent_id}/sop`），与计划列表并存。

**YAML Schema（示例）：**
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

### Integration Examples

**Intervention Demo:**
- 用户提交干预让执行重新聚焦
- Flow:
  1. 用户创建 run 并获取 `agent_id`
  2. 调用 `/api/runs/{run_id}/interventions` 提交消息
  3. 前端通过 WebSocket 收到 `task.requires_input`
  4. 任务树 UI 更新状态并展示干预内容

### Worker Constraints

**Docker Registry Restrictions:**
- Workers cannot pull directly from Docker Hub
- Use Aliyun Container Registry instead
- Pre-pull requirement: runners must have images cached before execution

**Worker Setup:**
1. Push all worker images to Aliyun Container Registry
2. Pre-pull images on runner nodes
3. Configure runner to use Aliyun Container Registry credentials
4. Verify image availability before task execution

## Quick Reference

| File | Purpose | Git Status |
|------|---------|------------|
| `config/llm-providers.example.json` | LLM provider template | Tracked |
| `/etc/web3d/llm-providers.json` | Production provider API keys (platform-private) | Outside git (NEVER COMMIT) |
| `/home/ravin/.web3d-secrets/llm-providers.json` | HK dev provider API keys (platform-private) | Outside git (NEVER COMMIT) |
| `config/runtime.example.json` | Runtime template | Tracked |
| `config/runtime.local.json` | Local runtime settings | Ignored (NEVER COMMIT) |
| `config/*.yaml` | Agent configuration | Tracked |
| `prompts/**/*.md` | Agent prompt text | Tracked |

## Common Mistakes

1. **Committing secrets:** Never commit actual `llm-providers.json` - use the example template
2. **Putting API keys in tenant config:** API keys belong in the LLM Gateway, not `runtime.local.json`
3. **Mixing config types:** Keep YAML for config, MD for prompts
4. **Forgetting key rotation:** Schedule regular API key rotation
5. **Ignoring worker pre-pull:** Test image availability before deployment
