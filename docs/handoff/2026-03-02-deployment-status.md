# 交接文档：部署状态与遗留问题

> 日期: 2026-03-02
> 状态: 部分完成
> 作者: Sisyphus Agent

## 当前部署状态

### 服务状态

| 服务 | 状态 | 说明 |
|------|------|------|
| api | ✅ healthy | 新代码已部署，模板库 API 正常 |
| dispatch | ✅ running | 已重启 |
| mcp-server | ✅ healthy | SearXNG 代理正常 |
| llm-gateway | ✅ running | LLM 代理正常 |
| worker-playwright | ✅ running | 浏览器自动化正常 |
| postgres | ✅ running | 数据库正常 |
| redis | ✅ running | 缓存/队列正常 |
| searxng | ✅ running | **但外部网络不通** |

### 已验证功能

1. ✅ **API 健康检查** - `/health` 返回正常
2. ✅ **模板库 API** - `GET /api/agent-templates` 返回 4 个模板
3. ✅ **模板详情 API** - `GET /api/agent-templates/searcher` 返回完整模板
4. ✅ **租户创建** - `POST /internal/tenants` 正常
5. ✅ **Run 创建** - `POST /api/runs` 正常
6. ✅ **团队导出** - `GET /api/runs/{run_id}/team/export` 正常
7. ⚠️ **SearXNG 搜索** - 内部调用正常，但外部搜索引擎超时

---

## 遗留问题

### 问题 1: SearXNG 外部网络不通

**现象**:
- SearXNG 容器可以解析 DNS（nslookup 正常）
- 但无法连接外部搜索引擎（google, duckduckgo, brave 等都超时）
- ping 测试显示 100% 丢包

**排查结果**:
```bash
# DNS 解析正常
docker compose exec -T searxng nslookup google.com
# 返回: 142.250.73.142

# 但 ping 丢包
docker compose exec -T searxng ping -c 2 google.com
# 返回: 100% packet loss

# 主机网络也无法访问外部
curl -s https://google.com --max-time 5
# 返回: 超时
```

**可能原因**:
1. 主机防火墙限制
2. 网络策略阻止外部访问
3. 代理配置问题

**建议修复**:
1. 检查主机防火墙: `sudo iptables -L -n`
2. 检查网络策略: `sudo ufw status`
3. 如果需要代理，配置 Docker 代理: `~/.docker/config.json`

---

### 问题 2: 团队导出/导入功能定位

**当前状态**:
- PRD 已更新：3.7 节改为 "Agent 模板库"
- 但 export/import API 仍保留在代码中
- 用户认为应该"彻底移除"

**需要确认**:
- 是否移除 `GET /api/runs/{run_id}/team/export`
- 是否移除 `POST /api/runs/team/import`
- 是否移除 `api/tests/test_team_templates.py`

---

## 新增/修改文件汇总

### 本次部署新增

| 文件 | 说明 |
|------|------|
| `docs/specs/2026-03-02-agent-template-library.md` | Agent 模板库规格 |
| `shared/agent-templates/*.yaml` | 4 个预制模板 |
| `api/app/template_loader.py` | 模板加载器 |
| `api/tests/test_agent_templates.py` | 模板测试 |
| `docs/handoff/2026-03-02-agent-template-library.md` | 功能交接文档 |

### Docker Compose 修改

| 文件 | 修改 |
|------|------|
| `docker-compose.yml` | 添加 `shared/agent-templates` 挂载到 api |
| `docker-compose.yml` | 添加 searxng 配置文件挂载 |
| `internal/searxng/config/settings.yml` | 禁用 limiter |

---

## 后续工作清单

### 优先级 P0

1. **修复 SearXNG 外部网络** - 检查防火墙/代理配置
2. **确认 export/import 去留** - 根据用户决策移除或保留

### 优先级 P1

1. **前端 UI** - 模板库浏览界面
2. **Agent 实例化 API** - `POST /api/runs/{run_id}/agents/instantiate`

---

## 验证命令

```bash
# 测试 API
curl -s http://127.0.0.1:8005/health

# 测试模板 API
curl -s http://127.0.0.1:8005/api/agent-templates

# 测试 SearXNG（需要外部网络）
docker compose exec -T mcp-server python -c "
import urllib.request, json
req = urllib.request.Request(
    'http://searxng:8080/search?q=test&format=json'
)
print(urllib.request.urlopen(req, timeout=30).read()[:100])
"

# 测试 MCP 搜索端点
curl -s -X POST http://127.0.0.1:8005/internal/search \
  -H 'Content-Type: application/json' \
  -H 'X-Internal-Key: test-internal' \
  -d '{"query": "test"}'
```

---

## 关键配置

### 环境变量 (.env)

```
ADMIN_API_KEY=test-admin
INTERNAL_API_KEY=test-internal
SEARXNG_SECRET_KEY=test-searx
LLM_PROVIDERS_HOST_PATH=/home/ubuntu/.roboard-secrets/llm-providers.json
```

### 服务端口映射

| 服务 | 内部端口 | 外部端口 |
|------|----------|----------|
| api | 8000 | 8000, 8005 |
| postgres | 5432 | 127.0.0.1:5432 |
| redis | 6379 | 127.0.0.1:6379 |

---

## 交接说明

如需继续此工作，请：

1. 读取本交接文档了解当前状态
2. 优先解决 SearXNG 外部网络问题
3. 确认 export/import 功能去留
4. 继续实现前端 UI 和 Agent 实例化 API

---

**文档路径**: `docs/handoff/2026-03-02-deployment-status.md`
---

## 2026-03-02 补充：SearXNG 问题根因

### 根因分析

经过详细排查，SearXNG 无法获取搜索结果的根因是：

**网络环境限制（GFW）阻止了搜索引擎访问**

```
# 主机可以访问 HTTP
curl -s "http://httpbin.org/ip" → 正常

# 容器也可以访问 HTTP  
docker exec wget "http://httpbin.org/ip" → 正常

# 但搜索引擎被阻止
docker exec wget "https://html.duckduckgo.com/html/?q=test" → 超时
docker exec wget "https://google.com" → 超时
```

### 解决方案

1. **配置代理**：在 SearXNG 容器中配置 HTTP_PROXY/HTTPS_PROXY
2. **使用国内搜索引擎**：配置 SearXNG 使用百度、搜狗等国内引擎
3. **部署到有外网的环境**：将 SearXNG 部署到 ravin（如果 ravin 有外网访问）

### 暂时方案

当前环境无法使用 SearXNG 搜索功能。可以先注释掉搜索相关功能，或使用预置的模拟数据。


---

## 2026-03-02 补充：export/import 功能状态

### 决策

根据 PRD v3.0 更新，export/import 功能**已改造为模板库**，而非彻底移除。

### 当前实现

| 组件 | 状态 | 说明 |
|------|------|------|
| `GET /api/runs/{run_id}/team/export` | ✅ 保留 | 导出团队为 YAML/JSON |
| `POST /api/runs/team/import` | ✅ 保留 | 从模板创建新 run |
| `GET /api/agent-templates` | ✅ 新增 | 列出预制模板 |
| `GET /api/agent-templates/{id}` | ✅ 新增 | 获取模板详情 |
| 预制模板 YAML | ✅ 新增 | `shared/agent-templates/*.yaml` |

### 模板库架构

```
预制模板 (shared/agent-templates/)
    ↓
模板加载器 (api/app/template_loader.py)
    ↓
模板 API (GET /api/agent-templates)
    ↓
团队导出/导入 (现有功能)
```

### 后续工作

1. 实现 `POST /api/runs/{run_id}/agents/instantiate` - 从模板实例化 Agent
2. 前端模板库浏览 UI
3. 将 export/import 与预制模板集成

