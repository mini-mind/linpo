# Worker Deployment Guide

**相关文档**: `docs/worker-ops.md` (运维手册)

## Overview

Worker stack 运行在 `ubuntu@175.178.213.10`：
- api :8000
- dispatch :7000
- worker-playwright :7100
- postgres :5432
- redis :6379
- 其他后端服务

## Port Mapping

| Service | Container | Host | Notes |
|---------|-----------|------|-------|
| api | 8000 | 0.0.0.0:8000 | 前端 host 必须可访问 |
| playwright-gateway | 7200 | 7200 | 仅允许 HK 主机访问 |

## Deployment

```bash
# Build and push
TAG=20260303-xxx ./ops/scripts/push_core_images.sh

# Deploy on worker host
docker compose pull && docker compose up -d
```

## Environment

```bash
# .env
ADMIN_API_KEY=...
INTERNAL_API_KEY=...
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
SEARXNG_URL=http://68.64.179.125:8081  # searxng deployed on ravin
```

## Verification

```bash
curl http://localhost:8000/health
docker compose ps
```
