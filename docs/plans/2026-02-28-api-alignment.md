# API 对齐清单（前端 <-> 后端）

## 范围

- 数据来源: `session-f-edge-ui/web-frontend/app.js`, `session-b-api/app/main.py`, `session-b-api/app/tree_api.py`, `session-b-api/README.md`
- 目标: 列出前端调用, 对应后端实现, 以及文档覆盖状态

## 对齐表

| 前端调用 | 前端用途 | 后端实现 | 文档状态 |
| --- | --- | --- | --- |
| `GET /api/auth/me` | 会话检查和用户信息 | `session-b-api/app/main.py` `get_me` | `session-b-api/README.md` 已覆盖 |
| `POST /api/auth/login` | 登录并获取 `session_token` | `session-b-api/app/main.py` `login_user` | `session-b-api/README.md` 已覆盖 |
| `POST /api/auth/register` | 注册并创建租户, 返回 `session_token` | `session-b-api/app/main.py` `register_user` | `session-b-api/README.md` 已覆盖 |
| `POST /api/auth/logout` | 退出并清理会话 | `session-b-api/app/main.py` `logout_user` | `session-b-api/README.md` 已覆盖 |
| `POST /api/runs` | 创建 run, 返回 `run_id` | `session-b-api/app/main.py` `create_run` | `session-b-api/README.md` 已覆盖 |
| `GET /api/runs/{run_id}/tree` | 读取 agent 树与 edges | `session-b-api/app/tree_api.py` `get_run_tree` | `session-b-api/README.md` 已覆盖 |
| `GET /api/agents/{agent_id}/sop` | 读取 agent SOP | `session-b-api/app/tree_api.py` `get_agent_sop` | `session-b-api/README.md` 已覆盖 |
| `POST /api/runs/{run_id}/actions` | run 控制和 SOP 替换 | `session-b-api/app/main.py` `create_action` | `session-b-api/README.md` 已覆盖 |
| `POST /api/runs/{run_id}/interventions` | 提交自然语言干预 | `session-b-api/app/main.py` `create_run_intervention` | `session-b-api/README.md` 已覆盖 |
| `GET /api/runs/{run_id}/agents/{agent_id}/sources` | 加载来源清单 | `session-b-api/app/tree_api.py` `get_agent_sources` | `session-b-api/README.md` 已覆盖 |
| `PUT /api/runs/{run_id}/agents/{agent_id}/sources` | 保存来源清单 | `session-b-api/app/tree_api.py` `put_agent_sources` | `session-b-api/README.md` 已覆盖 |
| `GET /api/runs/{run_id}/agents/{agent_id}/skills` | 加载技能清单 | `session-b-api/app/tree_api.py` `get_agent_skills` | `session-b-api/README.md` 已覆盖 |
| `POST /api/runs/{run_id}/agents/{agent_id}/skills/install` | 安装社区技能 | `session-b-api/app/tree_api.py` `install_community_skill` | `session-b-api/README.md` 已覆盖 |
| `POST /api/runs/{run_id}/agents/{agent_id}/skills/install-nl` | NL 安装社区技能 | `session-b-api/app/tree_api.py` `install_community_skill_nl` | `session-b-api/README.md` 已覆盖 |
| `GET /api/community-skills` | 获取社区技能列表 | `session-b-api/app/tree_api.py` `list_community_skills` | `session-b-api/README.md` 已覆盖 |
| `GET /api/community-skills/search` | 搜索社区技能 | `session-b-api/app/tree_api.py` `search_community_skills` | `session-b-api/README.md` 已覆盖 |
| `GET /api/runs/{run_id}/team/export` | 导出团队模板 | `session-b-api/app/tree_api.py` `export_team_yaml` | `session-b-api/README.md` 已覆盖 |
| `POST /api/runs/team/import` | 导入团队模板并创建新 run | `session-b-api/app/tree_api.py` `import_team_yaml` | `session-b-api/README.md` 已覆盖 |
| `WS /ws/runs/{run_id}` | 订阅 run 事件流 | `session-b-api/app/main.py` `run_events_ws` | `session-b-api/README.md` 已覆盖 |

## 备注

- 前端未使用但后端存在的端点, 未列入本表
