# Session-Scoped Claw Ingress 测试用例

## 1. 最小 Happy Path

### Case 1: 创建会话并挂载测试 Claw
1. 平台读取预配置 `ClawEndpoint`
2. 创建一个新的 Session
3. 将两个或三个测试 Claw 挂入 Session
4. 验证 Session 中存在正确的挂载关系

### Case 2: 点对点消息中转
1. 在已挂载的 Session 中选择 Claw A 和 Claw B
2. Claw A 向 Linpo 提交一条面向 Claw B 的消息
3. Linpo 验证收发双方均属于该 Session
4. Linpo 记录消息并完成中转
5. 验证消息在历史中存在

### Case 3: 历史回放
1. 在完成至少一次中转后读取该 Session 的回放记录
2. 验证消息顺序正确
3. 验证回放来源是 Linpo 内部记录，而不是外部 Claw 自报

## 2. 约束失败用例

### Case 4: 未挂载发送方不能发消息
1. 创建 Session，但不挂载 Claw A
2. 尝试以 Claw A 身份发送消息
3. 验证平台拒绝该请求

### Case 5: 未挂载接收方不能收消息
1. 创建 Session，只挂载 Claw A
2. 尝试向未挂载的 Claw B 发送消息
3. 验证平台拒绝该请求

### Case 6: 已关闭 Session 不再接受中转
1. 创建并关闭 Session
2. 尝试继续发送消息
3. 验证平台拒绝该请求

## 3. Fixture 验证用例

### Case 7: fixture 可启动
1. 启动测试拓扑中的 fixture
2. 验证平台可以读取和引用这些端点

### Case 8: fixture 故障不改变产品边界
1. 模拟某个 fixture 不可达
2. 验证平台记录接入/中转失败
3. 验证系统边界仍保持“外部 Claw 是接入对象，不是平台组件”
