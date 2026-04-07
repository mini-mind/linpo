# Linpo 开源私有化（个人/小团队）精简计划

## 1. 目标与边界

- 目标：先把 Linpo 做成个人与小团队可自部署、可维护、可排障的稳定版本。
- 范围：优先覆盖 `摘要 + 看板 + 流程 + 文件 + 实例接入` 主链路。
- 非目标（当前阶段不做）：企业级多租户、SSO/LDAP、复杂审批层级、会员/计费体系。
- 改造原则：本阶段采用 **breakly** 策略，允许破坏性调整；不做向后兼容别名、不做隐式兜底，默认快速失败并暴露错误。

## 2. 先做删减

1. 移除会员/充值入口与相关文案。
2. 清理旧 IA 残留页面与对应测试资产（未在 v0.7 主路由使用的页面）。
3. 清理面向托管运营的固定环境描述（如固定联调实例、固定外部域名口径）。
4. 清理“提示词式”接入教程，改为面向管理员的步骤化说明。

## 3. 再做已有能力改造

1. 实例接入流程收敛：
   - 默认 `配对会话`；
   - `Token` 作为显式手工路径（非自动兜底）；
   - 一键指令只保留稳定路径，不依赖额外审批客户端。
2. 配置口径统一：
   - 禁止写死公网地址；
   - 全部通过环境变量/配置项注入；
   - 缺失关键配置时直接报错，不再回退内置默认公网参数。
3. 错误可诊断性统一：
   - 前端统一展示 `错误码 + 原因 + 下一步`；
   - 接入、看板、流程、文件页面采用同一错误结构；
   - 取消“猜测式 fallback”（如路径自动猜测、隐式字段回填）。
4. 文档口径统一：
   - 面向“小团队管理员”写操作步骤；
   - 明确“需要一次性管理员预配置”的边界。

## 3.1 Breakly 落地清单（本轮）

1. API 版本化收口：
   - 仅保留 `/api/v1/**`，移除无前缀 legacy 路由。
2. 删除动作收口：
   - 仅保留 `DELETE /tasks/{id}` 与 `DELETE /requirements/{id}`；
   - 移除 `POST .../delete` 等兼容别名。
3. 产出文件读取收口：
   - 仅允许显式合法路径；
   - 移除“路径不存在时自动回退到其他产物路径”逻辑。
4. 数据与配置收口：
   - 对关键字段（如 board_id / planner 会话标识）从“空值回退默认值”改为“显式校验失败”；
   - 数据库连接配置缺失时直接失败，不使用硬编码 DSN。

## 4. 最小补充能力

1. `Setup` 向导（首登）：
   - 基础配置检查；
   - 实例配对引导；
   - 连通性校验。
2. 接入诊断页：
   - 一键检查 API、实例状态、实时通道；
   - 输出可复制诊断信息。
3. 最小运维能力：
   - 配置导出；
   - 关键数据快照与恢复说明。
4. 最小健康面板：
   - 实例在线状态；
   - 最近失败任务；
   - 审批积压数量。

## 5. 执行顺序（30 天）

1. 第 1 周：文档收敛与删减清单落地（先删减，再冻结口径）。
2. 第 2 周：实例接入与错误展示改造。
3. 第 3 周：Setup 向导与接入诊断。
4. 第 4 周：备份恢复说明、健康面板与发布验收。

### 本轮实施顺序（代码改造）

1. 后端 API 与服务先行（去兼容、去兜底、统一错误）。
2. 数据库与持久化规则跟进（字段约束与默认策略收紧）。
3. 前端最后对齐新契约（删除旧调用路径与兼容分支）。

### 分阶段执行模板（统一流程）

每个阶段都按固定流程执行：`调查 -> 设计 -> 实现 -> 测试 -> 验收`。

#### 阶段 1（后端解耦起点）

目标：断开 `services -> api` 反向依赖，先完成任务调度链路的单向分层。

1. 调查：
   - 梳理 `task_dispatch_service` 对 `api/task_output_helpers` 的依赖点；
   - 识别 `tasks/instances` 中复用的输出路径与依赖解析逻辑。
2. 设计：
   - 新建 `services/task_output_service.py` 承载可复用的任务输入/输出路径规则；
   - `api` 层仅保留 HTTP 协议处理，不新增服务层反向导入。
3. 实现：
   - `task_dispatch_service` 改为依赖 `services/task_output_service`；
   - 保持现有接口契约与错误语义不变。
4. 测试：
   - 单元：`tests/test_task_dispatch_service.py`、`tests/test_task_output_helpers.py`；
   - 集成：`tests/integration/test_tasks_api.py` 与 `tests/integration/test_instances_api.py` 的输出文件与调度关键用例。
5. 验收：
   - 代码中不再出现 `app/services/**` 导入 `app/api/**`；
   - 任务调度与产出预览相关测试全绿。

#### 阶段 2（任务调度重复逻辑清理）

目标：移除 `api/tasks.py` 中未使用且与 `TaskDispatchService` 重复的调度 helper，减少维护分叉。

1. 调查：
   - 确认 `_is_runnable_queued_task`、`_claim_task_for_dispatch`、`_build_task_dispatch_prompt` 无调用；
   - 确认运行路径已收口到 `TaskDispatchService`。
2. 设计：
   - 直接删除死代码，不保留兼容占位；
   - 保持现有错误文案与回调验签行为不变。
3. 实现：
   - 删除上述 3 个函数与相关无用导入；
   - 不改公开 API 路径与响应结构。
4. 测试：
   - 最小集：任务派发失败、回调签名与时效校验相关集成用例；
   - 补充跑 `tests/integration/test_tasks_api.py` 关键派发链路用例。
5. 验收：
   - `app/api/tasks.py` 不再包含重复调度实现；
   - 调度链路和回调安全相关用例全绿。

#### 阶段 3（tasks 内部死代码收口）

目标：清理 `app/api/tasks.py` 内已无调用的薄封装 helper，继续缩小 router 体积。

1. 调查：
   - 确认 `_task_temp_output_path`、`_task_temp_input_paths` 在阶段 2 后无调用；
   - 确认 `_parse_dependencies` 仅为单点透传封装。
2. 设计：
   - 删除无调用 helper；
   - 单点透传处直接使用底层 helper，避免二次包裹。
3. 实现：
   - 删除死代码与对应无用 import；
   - 保持接口行为、错误语义与文案不变。
4. 测试：
   - 跑 tasks dispatch/flow 关键集成用例与 task_dispatch 单元用例。
5. 验收：
   - `tasks.py` 不保留无调用薄封装；
   - 关键链路测试通过。

#### 阶段 4（dispatch 编排下沉 service）

目标：把 `tasks.py` 中 `_dispatch_queue*` 与 stale reconcile 薄封装下沉到 `TaskDispatchService`，让 router 只保留 HTTP 编排。

1. 调查：
   - 梳理 `create/list/callback/interrupt/continue/flow confirm` 对 `_dispatch_queue*` 的调用点；
   - 确认现有行为已由 `TaskDispatchService` 承载核心调度能力。
2. 设计：
   - 在 `TaskDispatchService` 增加公开编排方法：`dispatch_queue_once`、`dispatch_queue_for_task_owner`、`dispatch_queue_for_instance`；
   - `tasks.py` 全部改为调用 service 公开方法，不再保留本地 `_dispatch_queue*` 包装。
3. 实现：
   - 改造 service 与 `tasks.py` 调用路径；
   - 保持所有错误语义、回调签名、响应结构不变。
4. 测试：
   - 单元：`tests/test_task_dispatch_service.py`；
   - 集成：覆盖 create / flow confirm / callback / continue / delete node 等分发入口。
5. 验收：
   - `tasks.py` 不再包含 `_dispatch_queue*` 本地编排；
   - 分发关键链路测试全绿。

#### 阶段 5（flow_drafts 数据访问下沉）

目标：移除 `tasks.py` 的 `flow_drafts` 端点直连 ORM，收敛到独立 service。

1. 调查：
   - 锁定 `list_flow_drafts` / `upsert_flow_draft` / `delete_flow_draft` 的 SQL 与归一化逻辑；
   - 识别保持不变的错误语义（400/200 deleted=false）。
2. 设计：
   - 新增 `FlowDraftService` 提供 `list/upsert/delete`；
   - 路由仅保留参数校验与依赖注入，结果类型保持原 `response_model`。
3. 实现：
   - 下沉 ORM 访问与节点/泳道归一化逻辑到 service；
   - 不改 API 路径、状态码与返回结构。
4. 测试：
   - 最小集：`test_flow_drafts_are_persisted_and_queryable` + OpenAPI 分组测试；
   - 补充 flow_drafts 负向/更新行为用例。
5. 验收：
   - `tasks.py` 的 flow_drafts 端点不再直接 `execute/add/delete/commit`；
   - flow_drafts 相关回归全绿。

#### 阶段 6（realtime 访问收口）

目标：移除 `realtime.py` 中 router 级 `Session(get_engine(get_database_url()))`，统一通过 service 访问用户/实例上下文。

1. 调查：
   - 锁定 `_resolve_realtime_openclaw_context`、`_resolve_http_realtime_user`、`_resolve_sse_instance_id` 的手动会话创建点。
2. 设计：
   - 新增 `RealtimeAccessService` 封装会话打开、用户鉴权与实例归属校验；
   - `realtime.py` 仅保留协议层逻辑（WS/SSE 消息流）。
3. 实现：
   - 将上述 3 个解析函数改为调用 service；
   - 不改 WS/SSE 契约、状态码与错误文案。
4. 测试：
   - 运行 observer ws 与 sse 相关集成测试；
   - 增加架构守卫，禁止 `app/api/realtime.py` 直接创建 SQLAlchemy `Session`。
5. 验收：
   - `realtime.py` 不再导入/使用 `Session`、`get_engine`、`get_database_url`；
   - observer/realtime 关键链路测试通过。

#### 阶段 7（planner 事务边界收口）

目标：移除 `tasks.py` planner 端点中的冗余 `db_session.commit()`，将提交职责收敛到 `flow_planner_session_service`。

1. 调查：
   - 锁定 `stop/upsert/delete/complete/fail` 端点 commit 点；
   - 确认 service 调用链已内含提交。
2. 设计：
   - 先移除上述 5 个端点的冗余提交；
   - `generate` 的会话+指令提交下沉放到后续阶段，避免一次改动过大。
3. 实现：
   - 删除 `tasks.py` 对应 commit 语句；
   - 不改业务行为、错误语义与响应结构。
4. 测试：
   - 跑 planner 端点最小集（generate / upsert+delete / complete+fail+stop）；
   - 新增架构守卫防止这 5 个端点再次出现显式 commit。
5. 验收：
   - 5 个 planner 端点不再显式 commit；
   - planner 关键集成用例全绿。

#### 阶段 8（generate 事务边界收口）

目标：移除 `generate_flow` 端点中的 2 处显式 `db_session.commit()`，使 API 层彻底不承担事务提交。

1. 调查：
   - 确认 `ensure_session/append_message` 调用链内部已完成必要提交。
2. 设计：
   - 保持当前调用顺序与错误语义不变，仅删除端点级冗余提交；
   - 不改 dispatch 与会话 key 生成逻辑。
3. 实现：
   - 删除 `generate_flow` 中 2 处 `db_session.commit()`；
   - 不改响应结构与错误文案。
4. 测试：
   - 最小集：`test_flow_generate_starts_persistent_planner_session` + planner 相关关键回归。
   - 新增护栏：禁止 `generate_flow` 出现 `db_session.commit()`。
5. 验收：
   - `app/api/tasks.py` 无 `db_session.commit()`；
   - flow generate / planner 链路测试全绿。

#### 阶段 9-A（auth 会话事务边界收口）

目标：移除 `auth_service` 内部自建会话，统一由调用方注入 `db_session`，避免跨事务漂移。

1. 调查：
   - 锁定 `store_session/load_session/delete_session` 使用 `Session(get_engine(...))` 的路径；
   - 确认 `get_authenticated_user` 依赖上述路径会引入额外事务。
2. 设计：
   - 三个函数改为显式接收 `db_session`；
   - `api/auth.py` 的 `register/login/logout` 与 `get_authenticated_user` 调用链同步改签名。
3. 实现：
   - 删除 `auth_service` 对 `get_engine/get_database_url` 依赖；
   - 会话写入/读取/删除均在调用方会话上下文中执行。
4. 测试：
   - `test_auth_api` + `test_observer_ws` + `test_architecture_constraints` + `test_db_session`。
5. 验收：
   - `auth_service` 不再自建 `Session(engine)`；
   - 认证与实时链路回归全绿。

#### 阶段 9-B（realtime/planner 会话显式化）

目标：继续消除服务层隐式会话来源，要求会话由调用方显式注入。

1. 调查：
   - 锁定 `realtime_access_service` 与 `flow_planner_session_service` 的内部会话入口。
2. 设计：
   - `RealtimeAccessService` 所有访问方法显式接收 `db_session`；
   - `FlowPlannerSessionService` 禁止在 `db_session=None` 时自动创建会话（改为显式失败）。
3. 实现：
   - `api/realtime.py` 在 WS/SSE 路由中注入 `get_session` 并透传给 service；
   - `flow_planner_session_service` 删除内部 `Session(get_engine(get_database_url()))` 分支。
4. 测试：
   - `auth + observer_ws + architecture_constraints + flow_planner` 关键集回归。
5. 验收：
   - `realtime_access_service` 与 `flow_planner_session_service` 不再隐式打开数据库会话；
   - 关键回归测试全绿。

## 6. 验收标准

1. 新用户按文档可在 30 分钟内完成部署与首个实例接入。
2. 接入失败时，界面可给出明确下一步，不依赖开发者口头支持。
3. 主链路（流程创建、运行、审批、产出查看）在单机部署稳定可用。
4. 升级与回滚步骤可按文档复现。
