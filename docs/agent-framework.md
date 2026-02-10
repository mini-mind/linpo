# Agent Framework Documentation

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

### Agent-to-Agent (A2A) Communication

**Thread Access:**
- A2A provides tenant-wide access to conversation threads
- Access via GET `/api/a2a/threads/{id}`
- Thread IDs are shared across agents within the same tenant
- Enables context continuity between agent handoffs

### Integration Examples

**GitHub Trending Demo:**
- CEO chat triggers browser automation pipeline
- Flow:
  1. CEO requests GitHub trending analysis
  2. Agent spawns browser automation via Playwright gateway
  3. Playwright fetches trending repositories
  4. Results returned to CEO context
  5. Analysis performed and presented

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
| `/etc/web3d/llm-providers.json` | Actual provider API keys (platform-private) | Outside git (NEVER COMMIT) |
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
