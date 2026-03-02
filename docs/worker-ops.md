# Worker Operations Manual

[← 文档中心](README.md) | [Worker 部署指南](worker-deployment.md)

本指南适用于部署后的运维工作。首次部署请参考 [Worker 部署指南](worker-deployment.md)。

## 版本确认

确认当前运行的镜像标签：

```bash
# 检查运行的镜像标签
ssh ubuntu@175.178.213.10 'docker ps --format "{{.Names}}\t{{.Image}}" | grep playwright-gateway'

# 健康检查
curl -H "X-Internal-Key: your-secret-key" http://175.178.213.10:7200/health
```

升级步骤请参考 [Worker 部署指南](worker-deployment.md) 的 "升级 / 更新 Worker 到最新镜像" 章节。

This document provides operational guidance for maintaining the Tencent worker host `175.178.213.10`.

## Host Identity

- **IP Address**: `175.178.213.10`
- **SSH User**: `ubuntu`
- **Working Directory**: `~/roboard-worker`
- **Docker Installation**: Ubuntu packages (system-managed)
- **Swap Configuration**: 16GB at `/swap.img`, swappiness 10

Verify swap status:
```bash
ssh ubuntu@175.178.213.10
free -h
cat /proc/sys/vm/swappiness  # Should be 10
```

## Services on Worker

The worker runs two core services via Docker Compose in `~/roboard-worker/docker-compose.yml`:

1. **playwright-gateway**: API gateway that accepts browser automation requests
   - Port: `7200` (exposed for HK server access)
   - Orchestrates runner containers via Docker API

2. **docker-socket-proxy**: Secure proxy for Docker daemon socket
   - Mounts `/var/run/docker.sock` read-only
   - Allows only `POST` operations (create containers)
   - Blocks destructive operations (`DELETE`, `PUT`, `PATCH`, `GET`)

Compose file location: `ops/deploy/worker/docker-compose.yml` in the repository.

## Port Mapping Summary

| Service | Host Port | Access |
| --- | --- | --- |
| api | 8000 | Split 部署时供前端 host 访问 |
| playwright-gateway | 7200 | 仅 HK 主机访问 |

Conflict prevention:
- Split 部署需要 worker 的 8000 对前端 host 可达。
- 若 worker 仅用于 Playwright，可关闭 8000 以减少暴露面。

## Registry Constraints

**Critical**: The worker host cannot reliably pull images from Docker Hub (docker.io).

All third-party images must be mirrored into Aliyun Container Registry (ACR) before deployment.

**Mirrored Image**:
- `docker-socket-proxy`: `registry.cn-hangzhou.aliyuncs.com/ravin/docker-socket-proxy:0.1.1`
  - Source: `tecnativa/docker-socket-proxy:0.1.1`
  - Automatically mirrored by `ops/scripts/push_worker_images.sh`

**Never reference Docker Hub images directly in the worker compose file.**

## ACR Repositories

Worker images are stored in `registry.cn-hangzhou.aliyuncs.com/ravin/`:

- `roboard-playwright-runner:${TAG}` - Browser automation runner container
- `roboard-playwright-gateway:${TAG}` - API gateway service
- `roboard-worker-playwright:${TAG}` - Worker playbook (if applicable)

## Tag Strategy

**Format**: `YYYYMMDD-<git-short-sha>`

Example: `20260209-0277415`

**Why this strategy?**
- **Traceability**: Tag links directly to Git commit
- **Rollback**: Can immediately identify and deploy previous versions
- **Uniqueness**: Date + commit hash guarantees no conflicts

The push script defaults to this format if `TAG` is not set:
```bash
TAG="${TAG:-$(date +%Y%m%d)-$(git rev-parse --short HEAD)}"
```

## Authentication Model

The worker uses `INTERNAL_API_KEY` as a shared secret for service-to-service authentication.

- **Usage**: Passed in `X-Internal-Key` HTTP header
- **Scope**: Shared between Hong Kong main server and worker gateway
- **Validation**: Gateway rejects requests without matching key
- **Storage**: Environment variable only (never in git)

**Secret Management**:
- Store in HK main server's `.env` file (`.gitignore` prevents commits)
- Set during deployment: `INTERNAL_API_KEY=your-secret ./ops/scripts/deploy_worker.sh`
- Never include actual keys in documentation or configuration files

## Firewall Configuration

**Critical Rule**: Restrict worker port `7200/tcp` to Hong Kong server IPs only.

**Example Aliyun Security Group Rules**:

| Protocol | Port Range | Source IP       | Policy |
|----------|------------|-----------------|--------|
| TCP      | 7200       | HK_SERVER_IP/32 | Allow  |
| TCP      | 7200       | 0.0.0.0/0       | Deny   |

The worker gateway should only be accessible from the HK main server. Direct internet access is a security risk.

## Update Workflow

### Prerequisites
1. Docker logged into ACR on local machine:
   ```bash
   docker login registry.cn-hangzhou.aliyuncs.com
   ```

2. Docker logged into ACR on worker host:
   ```bash
   ssh ubuntu@175.178.213.10
   docker login registry.cn-hangzhou.aliyuncs.com
   ```

3. `INTERNAL_API_KEY` value available (from HK `.env`)

### Step 1: Build and Push Images

Generate tag and push to ACR:
```bash
TAG=20260209-0277415 ./ops/scripts/push_worker_images.sh
```

The script:
- Builds runner, gateway, and worker images
- Mirrors `docker-socket-proxy` to ACR
- Pushes all images to `registry.cn-hangzhou.aliyuncs.com/ravin/`

### Step 2: Deploy to Worker

Deploy with tag and shared secret:
```bash
INTERNAL_API_KEY=your-secret-key TAG=20260209-0277415 ./ops/scripts/deploy_worker.sh
```

The script:
- Creates `~/roboard-worker` directory
- Copies `ops/deploy/worker/docker-compose.yml`
- Pre-pulls runner image (see critical gotcha below)
- Runs `docker compose up -d` with environment variables

### Step 3: Verify Deployment

SSH into worker and check status:
```bash
ssh ubuntu@175.178.213.10
cd ~/roboard-worker

# Check running containers
docker compose ps

# View logs
docker compose logs -f

# Test health endpoint (replace with actual key)
curl -H "X-Internal-Key: your-secret-key" http://localhost:7200/health
```

## Critical Gotcha: Pre-Pull Requirement

**Problem**: The `playwright-gateway` container spawns runner containers via Docker API. When the runner image is not present locally, Docker attempts to pull it. However, the gateway container cannot supply ACR credentials to the host Docker daemon, causing pull failures.

**Solution**: The deploy script pre-pulls the runner image on the host before starting services:
```bash
docker pull registry.cn-hangzhou.aliyuncs.com/ravin/roboard-playwright-runner:${TAG}
```

**Manual Workaround**: If you manually restart services, ensure the runner image exists:
```bash
ssh ubuntu@175.178.213.10
docker images | grep playwright-runner
# If missing, pull with ACR credentials
docker pull registry.cn-hangzhou.aliyuncs.com/ravin/roboard-playwright-runner:<TAG>
```

## Troubleshooting Checklist

### Check Service Status

```bash
ssh ubuntu@175.178.213.10
cd ~/roboard-worker

# Running containers
docker compose ps

# All containers (including stopped)
docker compose ps -a
```

Expected output:
- `docker-socket-proxy`: running
- `playwright-gateway`: running

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f playwright-gateway
docker compose logs -f docker-socket-proxy

# Last 100 lines
docker compose logs --tail=100
```

### Health Check

```bash
# From worker host
curl -H "X-Internal-Key: your-secret-key" http://localhost:7200/health

# From HK server
curl -H "X-Internal-Key: your-secret-key" http://175.178.213.10:7200/health
```

Expected response: `{"status":"ok"}`

### Common Error Interpretations

**502 Bad Gateway from HK Server**:
- Cause: Worker gateway not running or network unreachable
- Check: `docker compose ps` on worker
- Check: Firewall rules allow HK IP to access 7200

**"Unable to pull image" or "permission denied"**:
- Cause: Worker not logged into ACR
- Fix: `docker login registry.cn-hangzhou.aliyuncs.com`

**"Failed to connect to docker-socket-proxy"**:
- Cause: Proxy service not running
- Check: `docker compose logs docker-socket-proxy`
- Fix: `docker compose restart docker-socket-proxy`

**"401 Unauthorized"**:
- Cause: `INTERNAL_API_KEY` mismatch
- Check: `docker compose exec playwright-gateway env | grep INTERNAL_API_KEY`
- Verify: Key matches HK server's `.env` value

**"Container exited with code 137" (OOM)**:
- Cause: Out of memory during browser task
- Check: `free -h` and swap configuration
- Expected: Swap should show 16G

**"Failed to start runner container"**:
- Cause: Runner image not available or ACR credentials issue
- Check: `docker images | grep playwright-runner`
- Fix: Pre-pull image on worker host

### Debugging Runner Containers

View temporary runner containers:
```bash
ssh ubuntu@175.178.213.10
docker ps -a | grep playwright-runner
```

These containers are created per request and cleaned up automatically. Stale containers may indicate cleanup failures.

## Disk Hygiene

### Check Disk Usage

```bash
ssh ubuntu@175.178.213.10

# Overall Docker disk usage
docker system df

# Image usage
docker images

# Volume usage
docker volume ls
```

### Prune Unused Resources

```bash
# Remove unused images (use with caution)
docker image prune -a

# Remove unused build cache
docker builder prune

# Remove stopped containers
docker container prune

# Comprehensive cleanup (review before running)
docker system prune
```

**Warning**: Pruning removes all unused images, not just old tags. Ensure desired images are tagged and in-use before pruning.

### Volume Management

**Tenant Volumes**: Playwright runner creates volumes prefixed `pw_ws_t_*` for browser workspace data. These may grow over time.

List and inspect volumes:
```bash
docker volume ls | grep pw_ws_t_
docker volume inspect <volume_name>
```

Cleanup strategy:
- Volumes are typically cleaned up when runner containers exit
- Manual removal: `docker volume rm <volume_name>`
- Monitor with `docker system df -v`

### Monitor Disk Space

```bash
# Check root filesystem
df -h

# Check inodes
df -i

# Find large directories
du -sh /var/lib/docker/* | sort -hr
```

Set up alerting if disk usage exceeds 80%.

## Rollback Procedure

To quickly revert to a previous version:

1. **Identify previous tag** from deployment history or Git log
2. **Deploy with previous tag**:
   ```bash
INTERNAL_API_KEY=your-secret TAG=<previous-tag> ./ops/scripts/deploy_worker.sh
   ```
3. **Verify rollback**:
   ```bash
   ssh ubuntu@175.178.213.10
   cd ~/roboard-worker
   docker compose ps
   docker compose logs -f
   ```

The tag strategy (`YYYYMMDD-<git-short-sha>`) makes identifying rollback targets trivial.

## Emergency Procedures

### Restart Services

```bash
ssh ubuntu@175.178.213.10
cd ~/roboard-worker
docker compose restart
```

### Force Re-deploy

```bash
# Stop and remove containers
docker compose down

# Redeploy (will pull images)
TAG=<current-tag> INTERNAL_API_KEY=<key> docker compose up -d
```

### Access Worker Shell

```bash
ssh ubuntu@175.178.213.10
```

From HK server, test connectivity:
```bash
ping -c 3 175.178.213.10
nc -zv 175.178.213.10 7200
```

## Security Reminders

- **Never expose Docker socket directly** to the internet. Always use `docker-socket-proxy`.
- **Restrict firewall** to allow only HK server IPs on port 7200.
- **Rotate secrets**: Change `INTERNAL_API_KEY` periodically and update both HK and worker.
- **Keep Docker updated**: Run `sudo apt update && sudo apt upgrade docker.io` regularly.
- **Monitor logs**: Watch for authentication failures or unusual pull attempts.
- **Audit containers**: Regularly review running containers for unexpected processes.

## References

- Deployment guide: `docs/worker-deployment.md`
- Push script: `ops/scripts/push_worker_images.sh`
- Deploy script: `ops/scripts/deploy_worker.sh`
- Compose file: `ops/deploy/worker/docker-compose.yml`
