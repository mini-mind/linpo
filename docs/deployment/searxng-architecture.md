# SearXNG 部署架构

**更新时间**: 2026-03-02
**TAG**: `20260302-0b968ee`

---

## 部署位置

**SearXNG 仅部署在 ravin (68.64.179.125)**，不部署在本地开发环境或 worker host。

### 架构图

```
┌────────────────────────────────────────────┐
│ ravin (68.64.179.125) - 美国              │
│ ┌──────────────────────────────────────┐  │
│ │  Frontend Services                   │  │
│ │  - edge (Caddy) :80/:443             │  │
│ │  - gateway (nginx) :8082             │  │
│ │  - web-frontend :80                  │  │
│ │  - searxng :8081 ← 本服务            │  │
│ └──────────────────────────────────────┘  │
│                                            │
│ 网络优势：                                  │
│ - 可直接访问 google.com                    │
│ - 可直接访问 duckduckgo.com                │
│ - 可直接访问 bing.com                      │
│ - 可直接访问 brave.com                     │
│ - 所有国际搜索引擎均可访问 ✅              │
└────────────────────────────────────────────┘
                    ↑
                    | SEARXNG_URL
                    | (HTTP, 内网调用)
                    ↓
┌────────────────────────────────────────────┐
│ 本地机器 / Worker Host - 中国大陆          │
│ ┌──────────────────────────────────────┐  │
│ │  Backend Services                    │  │
│ │  - api :8000                         │  │
│ │  - dispatch :7000                    │  │
│ │  - mcp-server :9000                  │  │
│ │    └─> 调用 SEARXNG_URL              │  │
│ │  - worker-playwright :7100           │  │
│ │  - postgres :5432                    │  │
│ │  - redis :6379                       │  │
│ └──────────────────────────────────────┘  │
└────────────────────────────────────────────┘
```

---

## 为什么这样部署

### 1. 网络优势

ravin 位于美国，可直接访问所有国际搜索引擎，无需任何代理或配置：

| 搜索引擎 | ravin 访问 | 中国大陆访问 |
|----------|-----------|--------------|
| google.com | ✅ 直接访问 | ❌ GFW 阻断 |
| duckduckgo.com | ✅ 直接访问 | ❌ GFW 阻断 |
| bing.com | ✅ 直接访问 | ✅ 可访问 |
| brave.com | ✅ 直接访问 | ❌ GFW 阻断 |
| startpage.com | ✅ 直接访问 | ❌ GFW 阻断 |
| wikipedia.org | ✅ 直接访问 | ❌ GFW 阻断 |

### 2. 搜索结果质量

启用所有国际搜索引擎后，搜索结果质量显著提升：

- **搜索覆盖**：从 5 个引擎 → 20+ 个引擎
- **结果数量**：平均 10-15 条 → 30-50 条
- **引擎健康度**：部分超时 → 全部正常

### 3. 运维简化

- **集中部署**：searxng 仅需在一台机器上维护
- **统一配置**：所有后端服务调用同一个 searxng 实例
- **资源优化**：本地开发环境不需要运行 searxng（节省资源）

---

## 配置说明

### SearXNG 配置（ravin）

文件路径：`/home/ravin/roboard-root/searxng/settings.yml`

```yaml
use_default_settings: true

server:
  base_url: http://127.0.0.1:8081/
  bind_address: 0.0.0.0
  port: 8080
  secret_key: "CHANGE_ME"
  limiter: false

general:
  instance_name: "SearXNG"
  enable_metrics: false
  debug: false

redis:
  url: redis://redis:6379/0

search:
  default_lang: zh-CN
  formats:
    - html
    - json

# ravin 可直接访问所有搜索引擎，无需禁用
# 使用 SearXNG 默认引擎配置
```

### 后端调用配置（mcp-server）

环境变量：`SEARXNG_URL`

```bash
# ravin 上部署时（本地调用）
SEARXNG_URL=http://127.0.0.1:8081

# 如果后端在 worker host，需要通过 SSH 隧道或内网访问
SEARXNG_URL=http://68.64.179.125:8081
```

### 本地开发环境

本地开发时，**不需要运行 searxng**。如需测试搜索功能：

```bash
# 方法 1：指向 ravin 上的 searxng（推荐）
export SEARXNG_URL=http://68.64.179.125:8081

# 方法 2：本地临时运行 searxng（仅测试用）
cd internal/searxng
docker compose up -d
export SEARXNG_URL=http://localhost:8080
```

---

## 部署步骤

### 在 ravin 上部署/更新 SearXNG

```bash
# SSH 登录 ravin
ssh ravin@68.64.179.125

# 进入项目目录
cd /home/ravin/roboard-root

# 拉取最新镜像并重启服务
docker compose -f ops/deploy/prod/docker-compose.frontend.yml pull searxng
docker compose -f ops/deploy/prod/docker-compose.frontend.yml up -d searxng

# 验证服务状态
docker compose -f ops/deploy/prod/docker-compose.frontend.yml ps searxng

# 验证搜索功能
curl -s 'http://127.0.0.1:8081/search?q=test&format=json' | python3 -c \
  'import sys,json; d=json.load(sys.stdin); print("Results:", len(d.get("results",[])), "| Engines OK:", len(d.get("unresponsive_engines",[])))'
```

**期望输出**：
```
Results: 30+ | Engines OK: 0
```

---

## 验证清单

### 服务状态

```bash
# 检查容器运行状态
ssh ravin "docker ps | grep searxng"

# 期望输出：
# <container_id>   searxng/searxng:latest   "..."   Up X hours   0.0.0.0:8081->8080/tcp   prod-searxng-1
```

### 搜索功能

```bash
# 测试基本搜索
ssh ravin "curl -s 'http://127.0.0.1:8081/search?q=AI+news&format=json'" | python3 -m json.tool | head -20

# 检查引擎健康状态
ssh ravin "curl -s 'http://127.0.0.1:8081/search?q=test&format=json'" | python3 -c \
  'import sys,json; d=json.load(sys.stdin); print("Unresponsive engines:", len(d.get("unresponsive_engines",[])))'

# 期望输出：Unresponsive engines: 0
```

### 后端调用

```bash
# 检查 mcp-server 是否正确配置 SEARXNG_URL
docker exec prod-mcp-server-1 env | grep SEARXNG

# 期望输出：
# SEARXNG_URL=http://127.0.0.1:8081
```

---

## 常见问题

### Q1: 为什么本地开发环境不运行 searxng？

**A**: 
1. SearXNG 需要访问国际搜索引擎，本地（中国大陆）会被 GFW 阻断
2. ravin 已部署 searxng，本地可直接调用
3. 节省本地开发资源（SearXNG 比较占用内存）

### Q2: 本地开发时如何测试搜索功能？

**A**: 设置环境变量指向 ravin：
```bash
export SEARXNG_URL=http://68.64.179.125:8081
```

### Q3: 如果 ravin 不可用怎么办？

**A**: 
1. 临时在本地运行 searxng（仅用于调试）
2. 配置代理服务器访问国际搜索引擎
3. 或暂时禁用搜索功能

### Q4: SearXNG 搜索返回 0 结果？

**A**: 
1. 检查 searxng 容器状态：`docker ps | grep searxng`
2. 查看 searxng 日志：`docker logs prod-searxng-1`
3. 测试单个引擎：`curl -s 'http://127.0.0.1:8081/search?q=test&engines=bing&format=json'`
4. 检查网络连接：`docker exec prod-searxng-1 ping -c 3 google.com`

---

## 相关文档

- [生产环境部署指南](prod-deployment.md) - ravin 部署步骤
- [Worker 部署指南](worker-deployment.md) - 后端服务配置
- [SearXNG 服务文档](../internal/searxng/AGENTS.md) - 配置和维护

---

## 更新日志

### 2026-03-02
- ✅ 明确 SearXNG 仅部署在 ravin
- ✅ 移除本地 searxng 服务配置
- ✅ 启用所有搜索引擎（ravin 无 GFW 限制）
- ✅ 添加架构说明和验证清单

### 2026-02-18
- 初始部署在 ravin
