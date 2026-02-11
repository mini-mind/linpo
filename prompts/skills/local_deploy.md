# Local Docker Deployment Skill

Guide the operator through pushing changes and deploying locally via Docker Compose for verification.

## Your Task

Generate a clear, step-by-step deployment plan that the operator can execute manually. You cannot run Docker yourself; output commands, checks, and expected results.

## Prerequisites

Before generating the plan, ensure the operator has:
- Docker and Docker Compose installed (`docker compose version` or `docker-compose version`)
- Docker daemon running
- Network connectivity for image pulls (if building from remote registry)
- Access to `.env` file with required secrets

## Core Services

Default deployment target (services backing `roboard.duckdns.org`):
- `edge` - Caddy reverse proxy (ports 80/443)
- `gateway` - Internal Nginx gateway (port 8082)
- `web-frontend` - Static file server
- `api-backend` - FastAPI backend (port 8000)
- `agent-manager` - Task scheduler (port 7000)
- `llm-gateway` - LLM provider multiplexer (port 7300)
- `mcp-server` - MCP protocol service

Optional/auxiliary services (deploy separately as needed):
- `postgres` - PostgreSQL database
- `redis` - Redis cache and message broker
- `searxng` - Search engine (port 8081)
- `mailhog` - Email testing (for dev, port 8025)

## Deployment Strategy

### 1. Validate Compose Configuration (Fail-Fast)

Before any build or deploy, verify the compose file is valid:

```bash
# Change to project root (docker-compose.yml location)
cd /path/to/project/root

# Validate compose configuration (quiet mode, fail on errors)
docker compose config -q
# OR fallback: docker-compose config -q

# If invalid, run without -q for detailed error output
docker compose config
```

If validation fails:
- Check YAML syntax (indentation, quotes)
- Verify all referenced files exist (env files, build contexts)
- Check for circular dependencies or conflicting configurations

### 2. Build and Deploy

**Full stack deployment** (default services):

```bash
# Build and start all default services
docker compose up -d --build edge gateway web-frontend api-backend agent-manager llm-gateway mcp-server

# Check deployment status
docker compose ps
```

**Minimal redeployment** (service subset):

When only specific services changed, redeploy only those:
```bash
# Redeploy just the API backend
docker compose up -d --build api-backend

# Redeploy frontend and API
docker compose up -d --build web-frontend api-backend
```

**Database/infrastructure first deployment**:

For initial setup or database schema changes:
```bash
# Deploy postgres and redis first
docker compose up -d postgres redis

# Wait for postgres to be ready
docker compose logs -f postgres

# Then deploy application services
docker compose up -d --build edge gateway web-frontend api-backend agent-manager llm-gateway mcp-server
```

### 3. Inspect Failures

If deployment fails:

```bash
# Check service status
docker compose ps

# View logs for a specific service
docker compose logs api-backend

# Follow logs in real-time
docker compose logs -f api-backend

# View recent logs (last 50 lines)
docker compose logs --tail=50 api-backend

# Check all services' logs
docker compose logs
```

Common failure modes:
- **Port conflicts**: Check if ports 80/443 are in use (`sudo lsof -i :80`)
- **Image build failures**: Check Dockerfile syntax, build context, base image availability
- **Environment variables missing**: Verify `.env` file has all required variables
- **Database connection errors**: Ensure postgres service is running and healthy

### 4. Verification Checklist

After deployment, verify with these checks:

**Service health**:
```bash
# Check all services are running
docker compose ps
# Expected: all services show "Up" or "running" status

# Check edge (Caddy) is serving
curl -I https://roboard.duckdns.org/
# Expected: HTTP 200 or 308 redirect

# Check API health endpoint
curl https://roboard.duckdns.org/api/health
# Expected: JSON response with status "ok"

# Check WebSocket upgrade works
curl -I -H "Upgrade: websocket" -H "Connection: Upgrade" \
  https://roboard.duckdns.org/ws/events
# Expected: 101 Switching Protocols or 400/426 (missing params)
```

**Bootstrap verification** (if applicable):
```bash
# Check bootstrap endpoint returns wss:// URL
curl https://roboard.duckdns.org/api/bootstrap
# Expected: JSON with "ws_url" containing "wss://roboard.duckdns.org"
```

**Internal service connectivity** (from within compose network):
```bash
# Access internal services via docker compose exec
docker compose exec api-backend curl http://localhost:8000/internal/health
docker compose exec gateway curl http://localhost:8082/health
```

### 5. Rollback

If verification fails and you need to rollback:

```bash
# Stop and remove deployed services
docker compose down

# Stop specific services only
docker compose stop api-backend
docker compose rm -f api-backend

# Re-deploy previous known-good state (if versioned)
git checkout docker-compose.yml
docker compose up -d
```

## Output Format

Return JSON with:

```json
{
  "commands": [
    "docker compose config -q",
    "docker compose up -d --build edge gateway web-frontend api-backend agent-manager llm-gateway mcp-server",
    "docker compose ps"
  ],
  "verification": [
    "curl -I https://roboard.duckdns.org/",
    "curl https://roboard.duckdns.org/api/health"
  ],
  "notes": "Deployed core services. Verify HTTP 200 from / and /api/health"
}
```

## Guidelines

- Always include `docker compose config -q` before any `up` or `build` commands (fail-fast)
- Separate full stack deployments from minimal redeployments based on user context (full vs. service subset)
- Provide commands for both `docker compose` and `docker-compose` fallbacks if needed
- Include log inspection commands in the `notes` or `verification` arrays for troubleshooting
- For production deployments, warn about the need to push images to remote registry first
- Do NOT include secrets or real API keys in output
- Assume the operator runs these commands; you generate the plan, not execute it
