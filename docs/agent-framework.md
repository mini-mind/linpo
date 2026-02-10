# Agent Framework Documentation

## Key Rules and Guidelines

### Configuration Separation

**YAML vs Markdown Separation:**
- YAML files (`config/*.yaml`) contain programmatic configuration and agent definitions
- Markdown files (`prompts/**/*.md`) contain human-readable prompts and descriptions
- Keep them separate: YAML is for the system to parse, MD is for humans to read

### Runtime Configuration

**Creating Local Runtime Settings:**
1. Copy `config/runtime.example.json` to `config/runtime.local.json`
2. Fill in your actual values:
   - `model.api_key`: Your VolcEngine ARK API key
   - `model.base_url`: VolcEngine ARK endpoint URL
   - `services.mcp_url`: MCP server endpoint
   - `services.playwright_gateway_url`: Playwright gateway endpoint
3. The application loads `runtime.local.json` at runtime
4. Never modify `runtime.example.json` - it contains placeholders only
5. **Never commit** `config/runtime.local.json` - it is gitignored and contains secrets

**Example runtime.local.json:**
```json
{
  "model": {
    "provider": "volcengine",
    "name": "ark-code-latest",
    "base_url": "https://ark.cn-beijing.volces.com/api/coding/v3",
    "api_key": "your-actual-api-key-here"
  },
  "services": {
    "mcp_url": "http://mcp-server:9000",
    "playwright_gateway_url": "http://175.178.213.10:7200"
  }
}
```

### Security Guidelines

**Never Commit Secrets:**
- API keys are in `.gitignore` via `config/runtime.local.json`
- Rotate API keys regularly (quarterly minimum)
- Do not log secrets in application logs
- Use environment variables for deployment secrets when appropriate

**Secret Rotation Process:**
1. Generate new API key
2. Update `runtime.local.json`
3. Test with new key
4. Revoke old key after successful deployment

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
| `config/runtime.example.json` | Template with placeholders | Tracked |
| `config/runtime.local.json` | Your actual runtime settings | Ignored (NEVER COMMIT) |
| `config/*.yaml` | Agent configuration | Tracked |
| `prompts/**/*.md` | Agent prompt text | Tracked |

## Common Mistakes

1. **Committing secrets:** Always use `.gitignore` and `runtime.local.json`
2. **Mixing config types:** Keep YAML for config, MD for prompts
3. **Forgetting key rotation:** Schedule regular API key rotation
4. **Ignoring worker pre-pull:** Test image availability before deployment
