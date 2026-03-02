# Worker Deployment Guide

**相关文档**:
- [文档中心](README.md) - 项目文档导航
- [Worker Operations Manual](worker-ops.md) - 部署后运维手册（故障排查、磁盘清理、日志回滚等）

This guide explains how to build and push worker Docker images to Aliyun ACR, and deploy the worker stack to the remote worker host.

## Overview

The worker stack consists of three services running on a dedicated worker host:

- **docker-socket-proxy**: Proxies the Docker daemon socket (required for spawning runner containers)
- **playwright-gateway**: API gateway that accepts browser automation requests and orchestrates runner containers
- **playwright-runner**: (Dynamical container) Executes Playwright browser automation tasks

### Worker Host Details

- **IP Address**: `175.178.213.10`
- **SSH User**: `ubuntu`
- **Working Directory**: `~/roboard-worker`
- **Swap Size**: 16GB (prevents OOM during heavy browser workloads)
- **Public Port**: `7200` (Playwright Gateway API)

### Port Mapping (Worker Host)

| Service | Container Port | Host Port | Notes |
| --- | --- | --- | --- |
| api | 8000 | 0.0.0.0:8000 | Split 部署时必须对前端 host 可达 |
| playwright-gateway | 7200 | 7200 | 仅允许 HK 主机访问 |

Conflict prevention:
- 若只部署 worker（Playwright），可以关闭 8000 的公网访问。
- Split 部署时必须开放 8000 给前端 host，否则 `/api/*` 会 502。

### Architecture

```
[Main Server HK]              [Worker Host CN]
      |                              |
      |  INTERNAL_API_KEY           |
      +-------------> 7200 --------> playwright-gateway
                              |
                              | DOCKER_HOST=tcp://docker-socket-proxy:2375
                              v
                    docker-socket-proxy (ro-mount /var/run/docker.sock)
                              |
                              | spawns ephemeral containers
                              v
                    playwright-runner (per request)
```

## Prerequisites

### Local Machine

1. **Docker installed** and running
2. **Docker login to Aliyun ACR**:
   ```bash
    docker login registry.cn-hangzhou.aliyuncs.com
    # Enter your Aliyun username and password when prompted
    ```

3. **Create project root `.env` (HK main host)**

Docker Compose will automatically load variables from the project root `.env`. This repo expects (at minimum):

```bash
ADMIN_API_KEY=...            # required by api
INTERNAL_API_KEY=...         # required by internal service-to-service auth
SEARXNG_SECRET_KEY=...        # required by searxng
PLAYWRIGHT_GATEWAY_URL=http://175.178.213.10:7200
```

**Important**: `.env` is ignored by git (`.gitignore` includes `.env` and `.env.*`).

### Worker Host

1. **Docker and Docker Compose** installed
2. **Docker login to Aliyun ACR** (for pulling images):
   ```bash
   ssh ubuntu@175.178.213.10
   docker login registry.cn-hangzhou.aliyuncs.com
   ```
3. **16GB swap** configured (verify with `free -h`)

## Aliyun ACR Repository

All worker images are stored in the Aliyun Container Registry:

- **Registry**: `registry.cn-hangzhou.aliyuncs.com/ravin/`
- **Repositories**:
- `roboard-playwright-runner:${TAG}` - Playwright runner container
- `roboard-playwright-gateway:${TAG}` - Playwright gateway service
- `roboard-worker-playwright:${TAG}` - Worker playbook (if any)
  - `docker-socket-proxy:0.1.1` - Docker socket proxy (mirror from tecnativa)

**Important**: The worker host cannot access Docker Hub directly. Therefore, `docker-socket-proxy` must be mirrored to ACR, and the compose file must reference the ACR image (`registry.cn-hangzhou.aliyuncs.com/ravin/docker-socket-proxy:0.1.1`).

## Deployment Workflow

### Step 1: Build and Push Images

From the project root, run:

```bash
# Recommended tag: YYYYMMDD-<git-short-sha> (script defaults to this)
TAG=20260209-0277415 ./ops/scripts/push_worker_images.sh
```

The script performs the following:

1. Builds `playwright-runner` image from `./playwright-runner`
2. Builds `playwright-gateway` image from `./playwright-gateway`
3. Builds `worker-playwright` image from `./worker-playwright`
4. Pulls `tecnativa/docker-socket-proxy:0.1.1` and mirrors it to ACR
5. Pushes all images to `registry.cn-hangzhou.aliyuncs.com/ravin/`

**Output Example**:
```
================================
PUSH WORKER IMAGES TO ACR
================================

TAG: 20260210-28d14cd
ACR_REGISTRY: registry.cn-hangzhou.aliyuncs.com
ACR_NAMESPACE: ravin

Images to push:
- registry.cn-hangzhou.aliyuncs.com/ravin/roboard-playwright-runner:20260210-28d14cd
- registry.cn-hangzhou.aliyuncs.com/ravin/roboard-playwright-gateway:20260210-28d14cd
- registry.cn-hangzhou.aliyuncs.com/ravin/roboard-worker-playwright:20260210-28d14cd
  - registry.cn-hangzhou.aliyuncs.com/ravin/docker-socket-proxy:0.1.1

[1/4] Building and pushing playwright-runner...
[2/4] Building and pushing playwright-gateway...
[3/4] Building and pushing worker-playwright...
[4/4] Mirroring docker-socket-proxy to ACR...

================================
PUSH COMPLETE
================================
```

### Step 2: Deploy to Worker Host

From the project root, run:

```bash
# Set the shared secret and tag
INTERNAL_API_KEY=your-secret-key TAG=20260209-0277415 ./ops/scripts/deploy_worker.sh
```

The script performs the following:

1. Creates `~/roboard-worker` directory on the worker host
2. Copies `ops/deploy/worker/docker-compose.yml` to the worker host
3. Runs `docker compose up -d` with environment variables:
   - `TAG=YYYYMMDD-<git-short-sha>` (used by compose file for image selection)
   - `INTERNAL_API_KEY=your-secret-key` (authentication secret)

**Environment Variables**:

- `WORKER_HOST`: Worker host IP (default: `175.178.213.10`)
- `WORKER_USER`: SSH user (default: `ubuntu`)
- `REMOTE_DIR`: Remote working directory (default: `~/roboard-worker`)
- `TAG`: Image tag (default: `latest`)
- `INTERNAL_API_KEY`: Shared secret between main server and worker (required)

### Step 3: Verify Deployment

SSH into the worker host and check the status:

```bash
ssh ubuntu@175.178.213.10

# Check running containers
cd ~/roboard-worker
docker compose ps

# Check logs
docker compose logs -f

# Verify gateway is accessible
curl -H "X-Internal-Key: your-secret-key" http://localhost:7200/health
```

## Docker Compose Configuration

The `ops/deploy/worker/docker-compose.yml` defines the worker stack:

```yaml
services:
  docker-socket-proxy:
    image: registry.cn-hangzhou.aliyuncs.com/ravin/docker-socket-proxy:0.1.1
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro  # Read-only mount
    environment:
      CONTAINERS: 1
      IMAGES: 1
      VOLUMES: 1
      NETWORKS: 1
      POST: 1
      GET: 0
      DELETE: 0
      PUT: 0
      PATCH: 0
    networks:
      - worker-net

  playwright-gateway:
    image: registry.cn-hangzhou.aliyuncs.com/ravin/roboard-playwright-gateway:${TAG:-latest}
    environment:
      INTERNAL_API_KEY: ${INTERNAL_API_KEY:?set}
      PW_RUNNER_IMAGE: registry.cn-hangzhou.aliyuncs.com/ravin/roboard-playwright-runner:${TAG:-latest}
      DOCKER_HOST: tcp://docker-socket-proxy:2375
    ports:
      - "7200:7200"
    networks:
      - worker-net
    depends_on:
      - docker-socket-proxy

networks:
  worker-net:
    driver: bridge
```

**Key Points**:

- `docker-socket-proxy` mounts `/var/run/docker.sock` **read-only** for security
- Proxy only allows `POST` operations (creating containers), blocking destructive actions
- `playwright-gateway` uses `INTERNAL_API_KEY` for authentication
- Runner images are pulled dynamically from ACR based on the same `TAG`

## Security Considerations

### INTERNAL_API_KEY

The `INTERNAL_API_KEY` is a shared secret used for authentication between the main server and the worker gateway:

- Must be identical on both the main server and worker host
- Should be a strong, randomly generated string (e.g., 32+ characters)
- Stored in environment variables, not in configuration files
- Treat this as a sensitive credential

### Firewall Configuration

**Recommendation**: Restrict port 7200 to the Hong Kong server IP only via cloud firewall.

**Example** (Aliyun security group rules):

| Protocol | Port Range | Source IP | Policy |
|----------|------------|------------|--------|
| TCP      | 7200       | HK_SERVER_IP/32 | Allow |
| TCP      | 7200       | 0.0.0.0/0  | Deny |

This prevents unauthorized access to the worker gateway from the internet.

### Docker Socket Security

- `docker-socket-proxy` mounts Docker socket read-only
- Proxy only allows `POST` operations (create containers)
- Destructive operations (`DELETE`, `PUT`, `PATCH`) are blocked
- `GET` operations are blocked to prevent information leakage

## Common Troubleshooting

### Issue: "Unable to pull image" or "permission denied"

**Cause**: Docker not logged in to ACR on the worker host.

**Solution**:
```bash
ssh ubuntu@175.178.213.10
docker login registry.cn-hangzhou.aliyuncs.com
# Enter Aliyun credentials
docker compose pull
```

### Issue: "Failed to connect to docker-socket-proxy"

**Cause**: Docker socket proxy service not running or network issue.

**Solution**:
```bash
ssh ubuntu@175.178.213.10
cd ~/roboard-worker
docker compose logs docker-socket-proxy
docker compose restart docker-socket-proxy
```

### Issue: "Container exited with code 137" (OOM)

**Cause**: Out of memory during browser task execution.

**Solution**:
1. Verify swap is configured:
   ```bash
   free -h
   # Should show Swap: 16G
   ```
2. If swap is missing, add 16GB swap:
   ```bash
   sudo fallocate -l 16G /swap.img
   sudo chmod 600 /swap.img
   sudo mkswap /swap.img
   sudo swapon /swap.img
   echo '/swap.img none swap sw 0 0' | sudo tee -a /etc/fstab
   ```

**Note**: The current worker already has 16GB swap configured at `/swap.img` with the fstab entry `/swap.img none swap sw 0 0`. The commands above are only needed if the swap needs to be rebuilt.

### Issue: "401 Unauthorized" when calling gateway API

**Cause**: `INTERNAL_API_KEY` mismatch or missing header.

**Solution**:
1. Verify the key is set in compose file:
   ```bash
   ssh ubuntu@175.178.213.10
   cd ~/roboard-worker
   docker compose exec playwright-gateway env | grep INTERNAL_API_KEY
   ```
2. Ensure main server uses the same key in requests:
   ```bash
   curl -H "X-Internal-Key: your-secret-key" http://175.178.213.10:7200/health
   ```

### Issue: "Failed to start runner container"

**Cause**: `docker-socket-proxy` cannot pull runner image from Docker Hub.

**Solution**:
Ensure compose file uses ACR images and `docker-socket-proxy` is mirrored:
```yaml
environment:
  PW_RUNNER_IMAGE: registry.cn-hangzhou.aliyuncs.com/ravin/roboard-playwright-runner:${TAG}
```

Re-run the push script to mirror images:
```bash
TAG=20260210-28d14cd ./ops/scripts/push_worker_images.sh
```

## Updating the Worker Stack

To update the worker stack with new images:

1. **Build and push new images**:
   ```bash
   TAG=20260211-3b8c3d1 ./ops/scripts/push_worker_images.sh
   ```

2. **Deploy with new tag**:
   ```bash
   INTERNAL_API_KEY=your-secret-key TAG=20260211-3b8c3d1 ./ops/scripts/deploy_worker.sh
   ```

3. **Verify deployment**:
   ```bash
   ssh ubuntu@175.178.213.10
   cd ~/roboard-worker
   docker compose ps
   docker compose logs -f
   ```

## Rollback Procedure

To rollback to a previous version:

1. **Identify the previous tag** (e.g., `20260210-28d14cd`)

2. **Deploy with previous tag**:
   ```bash
   INTERNAL_API_KEY=your-secret-key TAG=20260210-28d14cd ./ops/scripts/deploy_worker.sh
   ```

3. **Verify rollback**:
   ```bash
   ssh ubuntu@175.178.213.10
   cd ~/roboard-worker
   docker compose ps
   ```

## Appendix: Complete Deployment Example

```bash
# 1. Set variables
TAG=20260210-28d14cd
INTERNAL_API_KEY="your-32-character-random-secret-key"

# 2. Build and push images to ACR
TAG=$TAG ./ops/scripts/push_worker_images.sh

# 3. Deploy to worker host
INTERNAL_API_KEY=$INTERNAL_API_KEY TAG=$TAG ./ops/scripts/deploy_worker.sh

# 4. Verify deployment
ssh ubuntu@175.178.213.10
cd ~/roboard-worker
docker compose ps
docker compose logs -f

# 5. Test gateway health (exit SSH first or run inside)
curl -H "X-Internal-Key: $INTERNAL_API_KEY" http://175.178.213.10:7200/health
```

## 升级 / 更新 Worker 到最新镜像

将远程 worker 升级到最新代码构建的镜像，按以下步骤操作：

### Step 1: 确定版本 Tag

使用推荐的 Tag 格式：`YYYYMMDD-<git-short-sha>`

**示例**：`20260210-28d14cd`

获取 git 短 SHA：
```bash
git rev-parse --short HEAD
```

### Step 2: 构建并推送镜像

```bash
TAG=20260210-28d14cd ./ops/scripts/push_worker_images.sh
```

**注意**：如果脚本在镜像 `tecnativa/docker-socket-proxy:0.1.1` 时失败，需先确保该镜像在本地存在：
```bash
docker pull tecnativa/docker-socket-proxy:0.1.1
TAG=20260210-28d14cd ./ops/scripts/push_worker_images.sh
```

### Step 3: 部署到 Worker 主机

```bash
INTERNAL_API_KEY=your-secret-key TAG=20260210-28d14cd ./ops/scripts/deploy_worker.sh
```

### Step 4: 验证镜像 Tag

确认远程 worker 运行了正确的镜像 tag：

```bash
ssh ubuntu@175.178.213.10 'docker ps --format "{{.Names}}\t{{.Image}}" | grep playwright-gateway'
```

预期输出应包含你部署的 tag（检查 `...roboard-playwright-gateway:<TAG>`）：
```
...roboard-playwright-gateway:20260210-28d14cd
```

### Step 5: 功能验证

验证 worker health 端点正常响应：

```bash
curl -H "X-Internal-Key: your-secret-key" http://175.178.213.10:7200/health
```

预期响应：
```json
{"status":"ok"}
```
