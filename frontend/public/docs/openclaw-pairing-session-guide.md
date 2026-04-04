# OpenClaw 配对会话挂载教程（弱模型版）

本文用于指导 OpenClaw 在 Linpo「配对会话」模式下，稳定获取 `endpoint` 与 `gatewayToken` 并完成挂载。

## 目标

- 输入：`shortCode`、`name`、`attachApi`
- 输出：调用 `attachApi` 成功，Linpo 配对会话状态进入 `attached` 或 `bound`

## 固定流程

1. 读取当前 OpenClaw endpoint
- 优先读取配置中的网关地址。
- 若读取失败，返回错误，不要猜测。

2. 读取当前 OpenClaw token
- 执行：`openclaw config get gateway.auth.token`
- 若命令不可用，切换到网关容器后重试。
- 若输出显示脱敏占位符，按“值存在”处理，继续流程。

3. 校验字段
- `endpoint` 必须是非空 URL（含协议和端口）。
- `gatewayToken` 必须非空。
- 任一为空则终止并返回错误原因。

4. 调用 Linpo attach API
- 请求：`POST {attachApi}`
- Header：`Content-Type: application/json`
- Body：

```json
{
  "shortCode": "<shortCode>",
  "name": "<name>",
  "endpoint": "<endpoint>",
  "gatewayToken": "<gatewayToken>"
}
```

5. 返回结果格式
- 只返回 JSON，不要附加解释文本。
- 成功示例：

```json
{
  "ok": true,
  "shortCode": "<shortCode>",
  "name": "<name>",
  "endpointDetected": true,
  "gatewayTokenDetected": true,
  "attachHttpStatus": 200
}
```

- 失败示例：

```json
{
  "ok": false,
  "stage": "read_token | read_endpoint | attach",
  "reason": "具体错误原因"
}
```

## 失败处理要求

- 不要凭空编造 endpoint 或 token。
- 不要省略错误阶段与原因。
- 最多重试 2 次；仍失败必须返回失败 JSON。
