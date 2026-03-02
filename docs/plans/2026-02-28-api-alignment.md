# API 对齐清单（前端 <-> 后端）

## 范围

- 数据来源: `edge-ui/web-frontend/app.js`, `api/app/main.py`, `api/app/tree_api.py`, `api/README.md`
- 目标: 列出前端调用, 对应后端实现, 以及文档覆盖状态

## 对齐表

| 前端调用 | 前端用途 | 后端实现 | 文档状态 |
| --- | --- | --- | --- |
| `GET /api/auth/me` | 会话检查和用户信息 | `api/app/main.py` `get_me` | `api/README.md` 已覆盖 |
| `POST /api/auth/login` | 登录并获取 `session_token` | `api/app/main.py` `login_user` | `api/README.md` 已覆盖 |
| `POST /api/auth/register` | 注册并创建租户, 返回 `session_token` | `api/app/main.py` `register_user` | `api/README.md` 已覆盖 |
| `POST /api/auth/logout` | 退出并清理会话 | `api/app/main.py` `logout_user` | `api/README.md` 已覆盖 |
| `POST /api/runs` | 创建 run, 返回 `run_id` | `api/app/main.py` `create_run` | `api/README.md` 已覆盖 |
| `GET /api/runs/{run_id}/tree` | 读取 agent 树与 edges | `api/app/tree_api.py` `get_run_tree` | `api/README.md` 已覆盖 |
| `GET /api/agents/{agent_id}/sop` | 读取 agent SOP | `api/app/tree_api.py` `get_agent_sop` | `api/README.md` 已覆盖 |
| `POST /api/runs/{run_id}/actions` | run 控制和 SOP 替换 | `api/app/main.py` `create_action` | `api/README.md` 已覆盖 |
| `POST /api/runs/{run_id}/interventions` | 提交自然语言干预 | `api/app/main.py` `create_run_intervention` | `api/README.md` 已覆盖 |
| `GET /api/runs/{run_id}/agents/{agent_id}/sources` | 加载来源清单 | `api/app/tree_api.py` `get_agent_sources` | `api/README.md` 已覆盖 |
| `PUT /api/runs/{run_id}/agents/{agent_id}/sources` | 保存来源清单 | `api/app/tree_api.py` `put_agent_sources` | `api/README.md` 已覆盖 |
| `GET /api/runs/{run_id}/agents/{agent_id}/skills` | 加载技能清单 | `api/app/tree_api.py` `get_agent_skills` | `api/README.md` 已覆盖 |
| `POST /api/runs/{run_id}/agents/{agent_id}/skills/install` | 安装社区技能 | `api/app/tree_api.py` `install_community_skill` | `api/README.md` 已覆盖 |
| `POST /api/runs/{run_id}/agents/{agent_id}/skills/install-nl` | NL 安装社区技能 | `api/app/tree_api.py` `install_community_skill_nl` | `api/README.md` 已覆盖 |
| `GET /api/community-skills` | 获取社区技能列表 | `api/app/tree_api.py` `list_community_skills` | `api/README.md` 已覆盖 |
| `GET /api/community-skills/search` | 搜索社区技能 | `api/app/tree_api.py` `search_community_skills` | `api/README.md` 已覆盖 |
| `GET /api/runs/{run_id}/team/export` | 导出团队模板 | `api/app/tree_api.py` `export_team_yaml` | `api/README.md` 已覆盖 |
| `POST /api/runs/team/import` | 导入团队模板并创建新 run | `api/app/tree_api.py` `import_team_yaml` | `api/README.md` 已覆盖 |
| `WS /ws/runs/{run_id}` | 订阅 run 事件流 | `api/app/main.py` `run_events_ws` | `api/README.md` 已覆盖 |

## 备注

- 前端未使用但后端存在的端点, 未列入本表
