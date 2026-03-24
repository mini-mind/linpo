# Linpo v0.6 新 5 页 IA 对齐唯一计划

> **状态**：ACTIVE
> **用途**：当前阶段唯一执行入口
> **目标**：把 Linpo 从旧的 4 页 observer 口径整体迁移为用户最新确认的 5 页 IA：`overview / topology / kanban / team / session`，并以此作为后续实现、全面审查、复审补齐与投产收口的唯一 plan 基线。

---

## 1. 当前阶段唯一目标

当前阶段只做一件事：

把 Linpo 的当前 active UI 基线，整体替换为以下 **5 页 IA**：

- `/overview`
- `/topology`
- `/kanban`
- `/team`
- `/session`（实际路由形态见本计划第 6 节）

其中：

- `overview` 是主页，也是默认入口
- `topology` 是 IA 第一页
- `kanban` 是 IA 第二页
- `team` 是 IA 第三页
- `session` 是从某个 agent 进入的会话工作区页

当前阶段不新增第六个有效页面；`settings / profile` 明确列为 **out-of-scope / 暂缓**，不得被写成当前有效 IA，也不得在验收中冒充当前阶段完成项。

本阶段“可投产”含义固定为：

- 5 页 IA、页面职责、术语、路由语义、验证门禁全部切换到新世界观
- 已部署前后端地址可访问
- 浏览器级验收以已部署环境为准并可复现
- refresh / retry / 状态展示命中真实读链路
- 关键测试、build、健康检查通过
- 唯一留痕载体完整存在，足以支撑下一轮全面审查与复审补齐

当前阶段不处理：

- `v0.6` 之后的长期版本设计
- `settings / profile` 的产品定义与实现展开
- 与新 5 页 IA 无直接关系的额外页面扩张

---

## 2. 旧条款失效与新条款接管

本计划从本次重写起，明确替换旧 plan 中整套 4 页体系。以下旧条款 **全部失效**，不得继续作为当前执行依据：

| 旧条款/旧口径 | 状态 | 新接管条款 |
|------|------|------|
| 当前有效页面只有 `overview / topology / kanban / session` 四页 | 失效 | 当前有效页面固定为 `overview / topology / kanban / team / session` 五页 |
| `overview = agents-first watchlist` | 失效 | `overview = 主页/默认入口`，顶部汇总 token 与 agent 状态，主舞台为按实例分组的近期 token 消耗曲线，右侧为全局事件列表 |
| `topology = graph-only 关系画布，但仍沿用旧实例/agent/skill/ACP 语义` | 失效 | `topology = 满屏 routing graph`，泳道固定为 `实例 / 智能体 / 会话 / 工具`，节点为圆形，从属关系连线参考可移植锚点 `openclaw/geteway-routing-graph` |
| `kanban = Mission Control 风格只读板` | 失效 | `kanban = 任务板`，每张卡片一个任务，能力边界直接对齐可移植锚点 `openclaw/mission-control`，不再预设为“只读阉割版” |
| `team` 不存在或被当作附录能力 | 失效 | `team = 当前有效第三页`，直接参考可移植锚点 `openclaw/center` 的 `Staff` 页面，承接 persistent agent cards |
| `session = 单会话极简 drill-down` | 失效 | `session = 可开放对话的会话工作区`，从 agent 进入，左侧栏固定为“渠道在上，会话在下”，主区域为当前会话 |
| `session` 只保留 title / stream / input 的极简单列布局 | 失效 | `session` 必须支持渠道与会话切换，不再允许把它收缩回旧的单列极简页 |
| `overview / topology / kanban` 三页统一进入 `/session/:instanceId/:agentId` | 失效 | 会话进入改为“基于 agent 上下文的进入规则”，不再保留旧的三页统一进入语义 |
| 以 `observer-only` 作为总边界 | 失效 | 新边界改为“只实现本计划冻结的 5 页 IA 与其确认能力，不扩张到未冻结页面、系统设置面、运行控制面或长期平台能力” |
| 旧四页状态矩阵、旧四页验收清单、旧四页阻断项 | 失效 | 全量替换为本计划第 7 节、第 10 节、第 12 节定义的 5 页职责、矩阵、门禁与阻断规则 |
| 旧 `/session/:instanceId/:agentId` 单一路由语义 | 失效 | 新 session 路由必须能表达 agent / channel / current session 的当前上下文；旧路径如保留，只能作为兼容入口，不得继续代表当前产品语义 |

凡是旧 plan 中与上表冲突的内容，一律以本次重写后的新条款为准；不得保留旧骨架再做补丁式解释。

---

## 3. 当前有效页面集合、职责与 out-of-scope

### 3.1 当前唯一有效页面集合

| 页面 | 路由语义 | 当前角色 | 冻结结论 |
|------|------|------|------|
| `overview` | `/overview` | 主页 / 默认入口 | 有效 |
| `topology` | `/topology` | IA 第一页 | 有效 |
| `kanban` | `/kanban` | IA 第二页 | 有效 |
| `team` | `/team` | IA 第三页 | 有效 |
| `session` | `/session` 语义页，具体 URL 需承载 agent/channel/session 上下文 | 会话工作区 | 有效 |

### 3.2 明确暂缓项

以下内容当前明确为 **out-of-scope / 暂缓**：

- `settings`
- `profile`

对上述页面的处理规则固定为：

- 不纳入当前有效 IA 页面集合
- 不纳入当前阶段实现完成定义
- 不纳入当前阶段主链路浏览器验收
- 不得作为本轮补充页面偷渡进入导航、状态矩阵或完成标准

---

## 4. 页面参考锚点与冻结方式

执行时必须先锁定参考锚点到具体 commit SHA，并将路径/对象 + SHA 记入唯一留痕载体。未锁定前，不得宣称“已完成对齐”。

### 4.1 页面级参考锚点

#### overview
- 主参考锚点：`LINPO-OVERVIEW-HOME-V1`
- 该锚点固定指向：主页默认入口结构，且必须同时包含顶部 token/agent 状态统计区、按实例分组的近期 token 曲线主舞台、右侧全局事件列表三块
- 执行前必须在唯一留痕载体中把 `LINPO-OVERVIEW-HOME-V1` 绑定到具体实现路径、页面对象或设计样本；不得以“用户已确认”这类口头语义代替可复核对象
- 设计锚点：主页默认入口、顶部统计条、按实例分组的近期 token 消耗曲线、右侧全局事件列表
- 对齐重点：主页结构、信息密度、曲线阅读优先级、全局事件侧栏
- 明确不对齐：watchlist 首页、dashboard 大卡片首页、报告式首页、只保留 agent 列表的旧设计

#### topology
- 主参考锚点：可移植仓库标识固定为 `openclaw/geteway-routing-graph`；`../openclaw-geteway-routing-graph` 仅作为当前机器上的本地便利映射，不得单独作为唯一参考标识
- 对齐重点：满屏画布、泳道分层、圆形节点、从属连线、关系图浏览节奏
- 泳道冻结为：`实例 / 智能体 / 会话 / 工具`
- 明确不对齐：旧的 graph-only 极简画布口径、旧 skill / ACP 专属语义、右侧详情侧栏工作台

#### kanban
- 主参考锚点：可移植仓库标识固定为 `openclaw/mission-control`；`../openclaw-mission-control` 仅作为当前机器上的本地便利映射，不得单独作为唯一参考标识
- 对齐重点：任务板结构、列组织、卡片层级、任务推进与板面能力
- 卡片聚合单位冻结为：`每张卡片 = 一个任务`
- 明确不对齐：只读信号板、按 agent 聚合卡片、把 kanban 缩回 overview 衍生页

#### team
- 主参考锚点：可移植仓库标识固定为 `openclaw/center` 的 `Staff` 页面；`../openclaw-center` 仅作为当前机器上的本地便利映射，不得单独作为唯一参考标识
- 对齐重点：persistent agent cards、卡片密度、人员/席位式布置、卡片作为会话入口
- 卡片最小字段冻结为：agent 名字、实例名字、状态、最后会话时间、最后一次会话开头文字截断、头像
- 明确不对齐：附录页、可选页、只做一个 agent 列表子组件

#### session
- 主参考锚点：`LINPO-SESSION-WORKSPACE-V1`
- 该锚点固定指向：agent header、左侧渠道区、左侧会话区、当前会话主区、输入发送区五块同时成立的会话工作区
- 执行前必须在唯一留痕载体中把 `LINPO-SESSION-WORKSPACE-V1` 绑定到具体实现路径、页面对象与 SHA；不得以“当前确认”或“当前实现整体”代替可复核对象
- 对齐重点：可开放对话、从 agent 进入、左侧栏“渠道在上，会话在下”、主区域当前会话
- 明确不对齐：旧的单会话极简 drill-down、只读会话页、没有 sidebar 的极简单列承接页

### 4.2 参考裁决规则

当参考锚点与当前计划约束发生冲突时，裁决优先级固定为：

1. 本计划定义的 5 页 IA 与页面职责
2. 已部署环境可验证性与真实读链路
3. 页面级参考锚点与结构语言
4. 视觉密度与样式接近程度

允许语义等价实现；不允许为了贴近旧参考或旧 plan 文字，继续保留四页世界观。

### 4.3 overview / session 锚点精度补充

为避免 `overview` 与 `session` 的锚点继续自指或漂移，执行前必须在唯一留痕载体中额外冻结以下对象：

- `overview`：当前确认的主页结构样本，至少包含顶部统计区、实例 token 曲线主舞台、右侧全局事件列表三块的对应实现路径或页面对象
- `session`：当前确认的会话工作区样本，至少包含 agent header、左侧渠道区、左侧会话区、当前会话主区、输入发送区的对应实现路径或页面对象

若未冻结到可独立定位的实现路径、页面对象或设计样本，一律不得宣称该页已完成对齐。

---

## 5. 术语体系冻结

从本计划起，当前阶段统一使用以下术语：

| 术语 | 定义 |
|------|------|
| `overview` | 主页 / 默认入口；展示总体 token 与 agent 状态概览、按实例分组的近期 token 曲线、全局事件列表 |
| `topology` | routing graph 页面；满屏画布，按实例/智能体/会话/工具四条泳道组织结构 |
| `kanban` | 任务板；每卡一个任务，能力面对齐可移植锚点 `openclaw/mission-control` |
| `team` | 团队页；以 persistent agent cards 承接人员/席位式 agent 入口 |
| `session` | 会话工作区；从 agent 进入，带渠道区与会话区，可继续开放对话 |
| `channel` | session 左侧栏上半区对象，用于切换通信渠道或对话来源 |
| `session item` | session 左侧栏下半区对象，用于切换具体会话 |
| `persistent agent card` | team 页核心卡片；指向一个长期存在的 agent 身份入口 |
| `global event list` | overview 右侧全局事件流，不是 session 消息流替身 |
| `real read chain` | 页面 refresh / retry / 首次加载都必须命中真实后端读取，不得用 fixture/mock/static snapshot 冒充 |
| `唯一留痕载体` | 本轮变更随仓库一并提交的执行/验收记录文件；本计划要求记录的路径、SHA、裁决、验收证据都必须落在这里 |

以下旧术语明确废弃，不得在当前 plan 执行语义里继续使用：

- `observer-only`
- `watchlist overview`
- `kanban 只读板`
- `session 单会话极简 drill-down`
- `overview / topology / kanban 三页统一进入 session`
- `四页冻结语义`

---

## 6. 路由与跨页进入规则

### 6.1 导航与页面层级

- 默认落点固定为 `/overview`
- 主 IA 顺序固定为：`overview -> topology -> kanban -> team`
- `session` 是上下文工作区页，不是被旧四页逻辑吸进去的末级极简页
- 当前阶段不得新增第六个有效主页面来分担 `team` 或 `session` 职责

### 6.2 session 路由语义替换

新 `session` 路由必须满足以下要求：

- 当前阶段唯一 canonical session 路由固定为：`/session/:agentId/:channelKey/:sessionKey`
- 当某个 agent 当前不存在任何可用 channel 与可用 session 时，空工作区 canonical 路由固定为：`/session/:agentId/__none__/__new__`
- 当某个 agent 已有可用 channel、但当前没有可用具体 session 时，空会话 canonical 路由固定为：`/session/:agentId/:channelKey/__new__`
- 保留字冻结为：`__none__` 与 `__new__`；真实 `channelKey` 与 `sessionKey` 不得取这两个值，若外部系统存在同名 key，进入当前系统前必须先做稳定转义
- 稳定转义规则固定为：任何保留字冲突都必须采用前缀转义 `x--<original>`；反转义规则固定为仅当值以前缀 `x--` 开头且去前缀后恰好命中保留字时才执行反转义，不允许使用第二套编码/哈希/URL-safe 变体
- “可用 channel” 固定指：当前 agent 下可被真实读取、可在左侧渠道区列出且非 unauthorized/failed 占位对象的 channel
- “可用 session” 固定指：当前 agent/channel 下可被真实读取、可在左侧会话区列出且非 unauthorized/failed 占位对象的具体 session
- 其中 `agentId`、`channelKey`、`sessionKey` 都必须是可稳定恢复当前上下文的显式 URL 参数
- URL 需要能表达当前 agent 上下文
- URL 需要能恢复当前 channel 上下文
- URL 需要能恢复当前 session 上下文
- URL 中三类上下文的默认真源优先级固定为：显式 URL 参数 > 服务端解析出的当前有效对象 > 客户端本地记忆；若三者冲突，必须以此顺序裁决并在唯一留痕载体中记录
- 不允许仅靠客户端内存态恢复 channel 或当前 session
- 如果当前实现仍保留旧 `/session/:instanceId/:agentId` 形态，该路径只能视为兼容入口或降级入口，不得继续代表当前产品完整语义
- 旧 `/session/:instanceId/:agentId` 不得作为浏览器主链路验收、默认导航、页面设计说明或放行证据中的标准 session 路由样本
- 不允许再把 `instanceId + agentId` 单独视为 session 的唯一真源

### 6.3 进入规则

- `team`：点击 persistent agent card 必须进入该 agent 对应的 session 工作区；默认落点固定为“该 agent 最近活跃的 channel 下的最近活跃 session”；“最近活跃”统一按会话最后活动时间排序，若并列则按稳定唯一 session 标识排序；若不存在任何可用 session，则进入该 agent 的空工作区骨架并要求用户在侧栏选择/创建会话上下文
- `topology`：只有 `智能体` 与 `会话` 泳道节点允许直接进入 session；`实例` 与 `工具` 节点默认不得直接进入 session，除非当前节点已绑定唯一可恢复的 agent/session 上下文。所谓“绑定成立”固定指：执行该进入动作时，不需要额外用户选择，就能唯一恢复到一个 agent 工作区或一个具体 session，且该恢复规则已写入唯一留痕载体
- `topology`：若同一节点同时能映射 agent 与具体 session，默认优先进入具体 session；若无法唯一确定具体 session，则退回该 agent 工作区默认落点
- `overview`：仅以下对象允许直接进入 session：右侧全局事件列表中的 agent/session 相关事件、以及已在实现中绑定唯一 agent 上下文的图表交互对象。所谓“绑定唯一 agent 上下文”固定指：点击该对象时能唯一恢复一个 agent 工作区，且不需要再做实例/agent 二次选择
- `overview`：顶部统计卡与仅有实例维度的曲线点默认不得直接进入 session
- `overview`：默认首屏查询上下文固定为“全部实例 + 近期时间窗”；若实现支持记忆上次筛选，只能在不破坏该默认态可恢复性的前提下启用
- `kanban`：任务卡若只绑定单一 `agent/channel/session` 组合，则直接进入对应 session；若绑定单一 agent 但存在多个 channel/session，则进入该 agent 工作区默认落点；若绑定多组关联，则不得擅自选择，必须先进入任务上下文或要求用户显式选择
- `kanban`：所谓“进入任务上下文”固定指进入当前任务卡已存在的详情承接对象或当前板面内的任务上下文承接容器；不得借此新增第六个有效页面
- `kanban`：只有在关联唯一会话上下文时，才允许把任务卡点击直接定义为 session 进入动作
- `session`：当显式 URL 参数指向失效对象时，处理优先级固定为：先判断是否 `unauthorized`；若是，则进入未授权态；若不是未授权而是对象不存在或已失效，则进入失败态并禁止静默回退到其他对象；只有在 URL 未显式指定对应上下文时，才允许退回服务端当前有效对象或客户端记忆
- 不再保留“只要来自 overview / topology / kanban 就统一跳某个旧 canonical session”的语义

### 6.4 返回与状态恢复

- 从 `session` 返回来源页时，来源页需尽量恢复其上下文
- `overview` 最低恢复：时间范围、实例筛选、曲线滚动位置、右侧事件列表定位
- `topology` 最低恢复：视口、当前聚焦节点/边、泳道折叠状态
- `kanban` 最低恢复：当前列/筛选/横向滚动位置
- `team` 最低恢复：筛选、滚动位置、当前卡片聚焦
- 若恢复失败，只允许退回该页稳定默认态，不得随机跳转到其他对象

---

## 7. 5 页页面职责与交互冻结

### 7.1 overview

`overview` 是主页，也是默认入口。它不再承担旧 watchlist 首页语义。

**必须成立：**

- 顶部固定展示 token 统计与 agent 状态统计
- 主区域固定为“每个实例的近期 token 消耗曲线”
- 右侧固定保留全局事件列表
- 页面优先回答：当前各实例最近消耗如何、agent 总体状态如何、刚刚发生了什么
- refresh / retry 必须命中真实读链路，且能在曲线、统计或事件列表中体现刷新结果

**明确禁止：**

- 退回旧 watchlist 列表主舞台
- 退回 dashboard 大卡片首页
- 退回只按 agent 卡片巡视的旧结构
- 把全局事件列表塞进主区域，或把 token 曲线降级成附属图表

### 7.2 topology

`topology` 是 IA 第一页，承担 routing graph 主舞台。

**必须成立：**

- 页面为满屏画布，不回退成多栏工作台
- 泳道固定为：实例 / 智能体 / 会话 / 工具
- 节点形状固定为圆形
- 节点之间使用从属/依赖关系连线
- 结构语言直接参考可移植锚点 `openclaw/geteway-routing-graph`
- 交互优先服务于关系浏览、定位与切换，不引入旧世界观里的无关对象类型

**明确禁止：**

- 把 `skill / ACP` 继续冻结为当前 plan 的一等泳道对象
- 回退到旧的 graph-only 极简示意图而不承接 session / tool 泳道
- 重新长出详情侧栏、配置面板、统计面板挤占主舞台

### 7.3 kanban

`kanban` 是 IA 第二页，承担任务板语义。

**必须成立：**

- 每张卡片对应一个任务，而不是一个 agent
- 板面能力、列组织、交互方式直接对齐可移植锚点 `openclaw/mission-control`
- 当前 plan 不再预先把 kanban 冻结为“只读板”
- 页面重点是任务推进、协作状态与任务级上下文，而不是旧信号看板
- 若任务与 agent / session 相关联，允许以任务上下文进入 session 工作区

**明确禁止：**

- 把 kanban 再收缩回只读信号墙
- 用旧 `Mission Control 风格只读板` 文案继续定义当前页面
- 用 agent 卡片代替 task card

### 7.4 team

`team` 是 IA 第三页，不是附录，不是可选页。

**必须成立：**

- 页面直接参考可移植锚点 `openclaw/center` 的 `Staff` 页面
- 页面核心对象是 persistent agent cards
- 每张卡片最小字段必须包含：agent 名字、实例名字、状态、最后会话时间、最后一次会话开头文字截断、头像
- 点击卡片必须进入该 agent 对应的 session 工作区
- 页面承担“从团队视角进入 agent”的入口职责，而不是 overview 的附属分栏

**明确禁止：**

- 把 team 写成 appendix、future work 或 optional page
- 只做一个平铺 agent 列表，不体现 staff / persistent cards 语义
- 点击卡片后仍跳旧极简 session drill-down

### 7.5 session

`session` 继续保留，但语义完全替换为会话工作区。

**必须成立：**

- 页面可继续开放对话，不是只读页
- 页面从某个 agent 进入
- 左侧栏结构固定为：渠道在上，会话在下
- 主区域固定为当前会话
- 当前会话支持消息流、输入、发送、上下文切换与历史承接
- 页面不再被定义为旧的“单会话极简 drill-down 页面”

**明确禁止：**

- 把 session 收缩回仅有 title / stream / input 的旧极简页
- 把 session 写成只读消息回看页
- 省略 sidebar 或把 sidebar 中渠道/会话顺序写反

---

## 8. 高层替换风险与处理规则

本次迁移不是页面小修，而是基数替换。以下高层风险必须被显式处理：

### 8.1 页面集合基数替换
- 验证、导航、完成标准、留痕、截图、浏览器验收都必须从 4 页改为 5 页
- `team` 不能遗漏在任务、验收、阻断项之外

### 8.2 旧术语整体替换
- 凡是仍以 `observer-only`、`watchlist overview`、`kanban 只读板`、`session 极简 drill-down` 作为当前语义的实现/文档/验收，一律判定为未完成替换

### 8.3 旧路由整体替换
- 不允许继续把旧 `/session/:instanceId/:agentId` 单一路径当作所有主链路的唯一终点
- 新 session 路由语义需要覆盖 agent / channel / session 上下文；兼容入口不能反客为主

### 8.4 旧门禁整体替换
- 不再使用“overview / topology / kanban 严格只读 + session 唯一写入口”的旧门禁描述
- 当前门禁改为：只实现本计划冻结的 5 页职责与交互，不引入 `settings / profile`、运行控制面或未冻结的系统管理能力

### 8.5 旧状态矩阵与旧验证清单整体替换
- 状态矩阵必须改为覆盖五页
- 已部署浏览器验收必须改为五页主链路
- 阻断项、放行项、截图样本、真实读链路验证样本也必须同步改为五页口径

---

## 9. 当前环境、真实读链路与唯一留痕载体

### 9.1 当前环境约定

- 工作目录：`/data/projects/linpo`
- 前端部署地址：`http://175.178.213.10:5173`
- 后端部署地址：`http://175.178.213.10:8000`
- PostgreSQL 宿主机暴露端口：`40193`
- 后端测试统一使用：`/data/projects/linpo/.venv/bin/pytest`
- 浏览器验收默认使用一个已登录、具备当前 IA 主链路访问权限的测试身份；该身份标识、获取方式与有效性检查结果必须记录在唯一留痕载体中
- 浏览器验收默认使用一组固定样本：overview 的默认时间窗、topology 的一个可进入对象、kanban 的一个可进入任务卡、team 的一个可进入 agent card、session 的一个主样本路由；若样本变更，必须在唯一留痕载体中记录原因与替换样本

### 9.2 ravin 角色约定

- `ravin` 只承担远端访问与浏览器验收发起
- `ravin` 不承担仓库命令执行、构建、测试、部署
- 已部署浏览器验收优先由 `ravin` 发起，站在真实用户访问视角完成

### 9.3 真实读链路约定

- overview / topology / kanban / team / session 的首屏读取、refresh、retry 都必须命中真实后端读链路
- 不得使用 fixture、mock 响应、静态快照、前端伪更新时间来伪装刷新成功
- 页面需要保留 `request_id`、`freshness`、`partial_failure`、`diagnostics` 等可对账线索
- `partial_failure`、`failed`、`unauthorized` 必须可区分，不能伪装为空成功

### 9.4 唯一留痕载体

当前阶段凡是本计划要求“记录 / 写明 / 留痕 / 冻结”的内容，唯一允许的落盘位置固定为：

- `.sisyphus/plans/ui-design-realignment-execution-record.md`

不允许以下位置替代唯一留痕载体：

- 聊天消息
- 口头解释
- 临时本地笔记
- 只写在 commit message 的碎片说明
- 只写在 PR 描述但未回写仓库文件的内容
- 仅以外部 report link 代替仓库内证据索引

唯一留痕载体至少必须记录：

- 页面/模块名
- 参考仓库的可移植标识（仓库名、可定位页面/组件对象、来源说明）
- 对应 commit SHA
- 若发生冲突：冲突点、裁决依据、最终替代方案
- 若发生路由替换：旧语义、新语义、兼容策略
- 验收证据位置：测试命令、截图、请求记录、仓库内报告路径
- 每条证据的时间戳与适用环境（deployed/local）
- 若引用仓库外参考对象，必须给出足以让其他复审者在不同机器上重新定位该对象的说明，不得只写本机相对路径
- 对 unauthorized 豁免或不可达声明，必须附客观证据模板：测试身份、目标页面、目标动作、预期受限路径、实际结果、时间戳

若唯一留痕载体缺失、命名不一致、未随变更一并提交，或其内容不足以让复审者独立定位参考锚点与验收证据，一律视为阻断。

---

## 10. 5 页状态矩阵与最低验收口径

### 10.1 overview

- `loading`：顶部统计、曲线区、右侧事件区都要有明确加载状态
- `empty`：允许空曲线与空事件，但仍保持主页骨架
- `partial_failure`：统计、曲线、事件任一部分缺失时必须明确提示“部分数据不可用”
- `failed`：显示可读失败态与 retry
- `unauthorized`：显示未授权提示，不伪装为零数据成功
- `stale`：允许保留旧曲线/统计，但必须明确 stale

### 10.2 topology

- `loading`：允许画布 loading overlay
- `empty`：显示空图态，但不能退回列表页
- `partial_failure`：允许部分泳道/边缺失，但必须说明缺失来源
- `failed`：显示整图级失败态与 retry
- `unauthorized`：显示未授权态，不展示伪图
- `stale`：允许显示旧图，但必须标识 stale

### 10.3 kanban

- `loading`：显示板面级加载态
- `empty`：允许空板与空列，但仍保持任务板骨架
- `partial_failure`：部分任务/列缺失时必须提示不完整
- `failed`：显示板面级失败态与 retry
- `unauthorized`：显示未授权态，不伪装成零任务
- `stale`：允许保留旧板面，但必须标识 stale

### 10.4 team

- `loading`：显示 persistent agent cards 骨架
- `empty`：显示空团队态，但仍保留 team 页面语义
- `partial_failure`：部分 agent 卡缺字段或缺更新时必须明确提示
- `failed`：显示页面级失败态与 retry
- `unauthorized`：显示未授权态，不伪装成空 staff
- `stale`：允许保留旧卡片，但必须标识 stale

### 10.5 session

- `loading`：左侧渠道区、会话区、主会话区都应可见加载状态
- `empty`：允许空会话，但仍保持 sidebar + 当前会话骨架
- `partial_failure`：消息区可保留已加载内容，同时明确哪些部分失败
- `failed`：显示会话级失败态与 retry
- `unauthorized`：显示未授权态；输入区必须禁用并解释原因
- `stale`：允许保留旧消息，但必须标识 stale

**状态验收总规则：**

- 五页都必须按上表逐页验证，而不是只做 happy path
- `session` 的 `unauthorized` 不允许豁免
- 其余页面若主链路客观上不存在未授权可达路径，才允许在唯一留痕载体中写明理由后豁免

### 10.6 状态冲突裁决规则

当同一页面同时出现多个状态信号时，展示优先级固定为：

1. `unauthorized`
2. `failed`
3. `partial_failure`
4. `stale`
5. `empty`
6. `loading`

裁决规则：
- 若 `unauthorized` 成立，必须优先展示未授权态，不得被其他状态覆盖
- `failed` 固定指：当前主对象或主读取动作整体不可恢复完成，导致页面主舞台无法以部分成功形式继续承接；其默认表现为整页/整块失败态
- `partial_failure` 固定指：当前主对象或主读取动作仍有一部分成功结果可继续承接，但存在可明确指出的缺失、失败或不完整部分；其默认表现为保留已成功内容并附带部分失败提示
- 若 `failed` 与 `stale` 同时存在，以 `failed` 为主状态，但可附带 stale 提示
- 若 `partial_failure` 与 `stale` 同时存在，以 `partial_failure` 为主状态，但可附带 stale 提示
- `empty` 仅在没有更高优先级错误/未授权/部分失败信号时才可成为主状态
- `loading` 只在首屏或主动刷新过程中可作为主状态；一旦收到明确失败/未授权/空态信号，必须退让给更高优先级状态

---

## 11. 执行任务

### Task 1：冻结新 5 页 IA 并清除旧世界观

**目标**：让后续执行者只读本计划，就知道当前有效页面集合、术语体系、旧条款失效清单与高层替换风险。

**必须完成：**

- 用新 5 页 IA 替换旧四页口径
- 写清旧条款失效与新条款接管
- 明确 `settings / profile` 为暂缓项
- 明确旧路由、旧门禁、旧状态矩阵、旧验证清单均已被替换

**完成判定：**

- 本计划内部不再依赖旧四页语义才能继续执行
- 复审者只读本计划即可知道当前阶段不再接受旧 world model

---

### Task 2：overview 重构为主页默认入口

**目标**：把 overview 从旧 watchlist 首页切换为主页/默认入口。

**必须完成：**

- 顶部 token 统计与 agent 状态统计成立
- 主区域为按实例分组的近期 token 消耗曲线
- 右侧全局事件列表成立
- overview 的状态矩阵、refresh/retry、真实读链路要求成立

**完成判定：**

- 页面一眼可辨识为主页/全局脉搏页，而不是旧 watchlist
- 执行记录中存在 overview 的结构截图、刷新证据、真实请求对账线索与状态验收记录

---

### Task 3：topology 重构为 routing graph

**目标**：把 topology 对齐为可移植锚点 `openclaw/geteway-routing-graph` 风格的满屏 routing graph。

**必须完成：**

- 满屏画布成立
- 四条泳道成立：实例 / 智能体 / 会话 / 工具
- 圆形节点与从属关系连线成立
- 节点进入 session 的规则明确且可验证

**完成判定：**

- 页面不再是旧 graph-only 极简图示页
- 执行记录中存在 topology 的参考锚点路径、SHA、截图、状态验收与进入链路样本

---

### Task 4：kanban 重构为任务板

**目标**：把 kanban 从旧只读信号板切换为任务板。

**必须完成：**

- 每卡一个任务
- 板面能力对齐可移植锚点 `openclaw/mission-control`
- 不再用旧只读板语义限制当前页面
- 与任务相关的 session 进入或任务上下文承接规则明确

**完成判定：**

- 页面主语义是 task board，而不是 agent signal board
- 执行记录中存在 kanban 的参考锚点路径、SHA、截图、状态验收与任务上下文样本

---

### Task 5：team 落地为第三页主入口

**目标**：新增并冻结 team 为 IA 第三页主入口。

**必须完成：**

- 页面直接参考可移植锚点 `openclaw/center` 的 `Staff` 页面
- persistent agent cards 成立
- 卡片字段满足本计划第 7.4 节最小字段要求
- 点击卡片进入 session 工作区成立

**完成判定：**

- team 不再是遗漏页、附录页或未来能力
- 执行记录中存在 team 的参考锚点路径、SHA、截图、状态验收与 session 进入样本

---

### Task 6：session 重构为会话工作区

**目标**：把 session 从旧极简 drill-down 页切换为可开放对话的会话工作区。

**必须完成：**

- 从 agent 进入
- 左侧栏“渠道在上，会话在下”成立
- 主区域为当前会话
- 输入与发送能力保留
- unauthorized 下输入禁用且原因可见

**完成判定：**

- 页面不再被认作旧单会话极简页
- 执行记录中存在 session 的结构截图、渠道/会话切换样本、发送能力样本、unauthorized 样本与请求对账线索

---

### Task 7：共享路由、状态、真实读链路与留痕收口

**目标**：确保五页共享约束一致，不把新 IA 做成只换外壳。

**必须完成：**

- 新 session 路由语义被明确记录
- refresh / retry 都命中真实读链路
- `request_id / freshness / partial_failure / diagnostics` 在五页保持可见且可对账
- 参考锚点、SHA、冲突裁决、验收证据都进入唯一留痕载体

**完成判定：**

- 不存在只改页面外观但共享语义仍停留在旧四页的情况

---

### Task 8：统一验证与投产收口

**目标**：以新 5 页 IA 为口径完成测试、浏览器验收、健康检查与放行判断。

**必须完成：**

- 组件测试、后端测试、build、质量门、健康检查通过
- 已部署浏览器验收覆盖 `overview / topology / kanban / team / session`
- 五页状态矩阵按第 10 节逐页验收
- 真实读链路、刷新证据、请求对账证据完整
- 下一轮全面审查所需的留痕足够完整

**完成判定：**

- 当前结果可作为后续全面审查、修正、再验收的唯一 plan 基线

---

## 12. 必跑验证与浏览器级验收门禁

### 12.1 必跑验证

以下验证仍是当前阶段硬门禁，不因 IA 改写而取消：

- `npm --prefix frontend run test`
- `/data/projects/linpo/.venv/bin/pytest`
- `npm --prefix frontend run build`
- `make quality`
- `curl -i http://175.178.213.10:8000/health`
- 从 `ravin` 发起的已部署浏览器验收

### 12.2 健康检查门禁

- 后端健康检查目标固定为：`http://175.178.213.10:8000/health`
- 必须返回健康结果
- 若返回 5xx、超时、空响应或错误页，一律阻断，不得放行

### 12.3 已部署浏览器验收门禁

浏览器验收必须满足：

- 从 `ravin` 发起
- 访问已部署前端 `http://175.178.213.10:5173`
- 在真实已登录用户态下完成
- 覆盖五个核心页面：`/overview`、`/topology`、`/kanban`、`/team`、一个符合第 6.2 节新语义的 `session` 路由样本
- 不得只凭拿到 `200` 或 shell 渲染成功就视为通过
- 不得把旧 `/session/:instanceId/:agentId` 兼容入口当作主 session 样本完成验收
- session 主链路样本不得只验证 1 条新语义入口而放任其他主入口继续走旧语义；凡是当前页面设计中被定义为 session 主入口的地方，都必须符合第 6.2 与第 6.3 节的当前规则
- 必须至少分别验证一次普通 canonical session、空工作区 canonical、空会话 canonical 三类路由样本；若当前环境客观不存在其中某类样本，必须在唯一留痕载体中记录原因与证据

每个核心页面的最小验收证据固定为：

- 访问 URL
- 页面截图
- 时间戳
- 至少一个可对账的 `request_id` 或同等唯一后端请求标识
- 一条可证明来自已部署后端的请求记录
- 若涉及 refresh / retry，必须附同一次读取链路上的前后对比证据

### 12.4 五页主链路最低定义

- `overview`：进入页面 -> 看到顶部统计 + 曲线主舞台 + 右侧事件列表 -> 触发 refresh 或时间范围切换 -> 对账真实请求；同时至少验证 1 个负向样本：顶部统计卡或仅实例维曲线点不得直接进入 session
- `topology`：进入页面 -> 看到满屏 routing graph 与四泳道 -> 选择可进入对象 -> 验证进入规则或禁用规则；同时至少验证 1 个负向样本：不满足绑定成立条件的实例/工具节点不得直接进入 session
- `kanban`：进入页面 -> 看到任务板与任务卡 -> 验证任务上下文或 session 承接 -> 对账真实请求；同时至少验证 1 个负向样本：多关联任务卡不得自动擅选 session
- `team`：进入页面 -> 看到 persistent agent cards -> 点击卡片 -> 进入对应 session；同时至少验证 1 个负向样本：缺失最小字段或缺少可恢复上下文的卡片不得伪装成可安全进入 session
- `session`：进入页面 -> 看到渠道区 / 会话区 / 当前会话区 -> 验证读取、切换、输入与 unauthorized 处理；同时至少验证 1 个负向样本：失效 URL 上下文不得静默回退到其他 session，对应失败态或未授权态必须成立

### 12.5 放行规则

只有同时满足以下条件，才允许宣称当前阶段通过：

- 五页 IA 已全部按新口径建立
- `team` 已进入完成定义，而不是附录
- 不再残留旧四页、旧术语、旧门禁、旧状态矩阵、旧验证清单
- 真实读链路、健康检查、浏览器验收、build、测试、质量门全部通过
- 唯一留痕载体完整存在

### 12.6 阻断规则

出现任一情况，一律阻断：

- 任一有效页面仍按旧四页世界观实现或验收
- `team` 缺失、被降级为附录或未纳入主链路验收
- `session` 仍是旧单会话极简页，或不支持 sidebar“渠道在上，会话在下”
- 浏览器验收中的 session 样本仍使用旧 `/session/:instanceId/:agentId` 兼容入口作为主语义路由
- `kanban` 仍按只读信号板验收
- `overview` 仍按 watchlist 或 dashboard 大卡片首页验收
- `topology` 未完成四泳道 routing graph 迁移
- 浏览器验收未覆盖五页
- 健康检查、build、测试或质量门任一失败
- 无法证明 refresh / retry 命中真实读链路

---

## 13. 最终完成标准

只有同时满足以下条件，才能认为当前阶段完成：

1. 当前有效页面集合固定为 `overview / topology / kanban / team / session`
2. `settings / profile` 已被明确标记为 out-of-scope / 暂缓，而不是被偷偷混入当前完成定义
3. `overview` 已成为主页/默认入口，并具备顶部统计、实例 token 曲线主舞台、右侧全局事件列表
4. `topology` 已成为四泳道满屏 routing graph，并对齐可移植锚点 `openclaw/geteway-routing-graph`
5. `kanban` 已成为任务板，每卡一个任务，并以可移植锚点 `openclaw/mission-control` 为能力锚点
6. `team` 已成为第三页主入口，并对齐可移植锚点 `openclaw/center` 的 `Staff` 页面
7. `session` 已成为可开放对话的会话工作区，具备“渠道在上，会话在下”的 sidebar 与当前会话主区
8. 不再残留 `observer-only`、`watchlist overview`、`kanban 只读板`、`session 极简 drill-down`、`三页统一进入 session` 等旧世界观作为当前有效口径
9. 新路由语义、真实读链路、状态矩阵、验证门禁都已切换到 5 页 IA 口径
10. 已部署前端/后端地址可访问，健康检查通过
11. `/data/projects/linpo/.venv/bin/pytest`、前端测试、build、质量门通过
12. 浏览器级验收已在 `ravin` 上对已部署环境完成，且覆盖五页主链路
13. 唯一留痕载体完整存在，能支持下一轮全面审查与复审补齐

---

## 14. 执行纪律

- 当前阶段只认本计划这一份 active plan
- 当前重写不是“补丁更新”，而是整套世界观替换
- 如实现、验收记录或后续 review 仍引用旧四页口径，必须先回到本计划修正
- 下一轮全面审查必须以本计划为基线，逐条检查是否仍有旧语义残留
