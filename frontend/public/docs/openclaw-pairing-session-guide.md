# OpenClaw 配对会话挂载教程（弱模型版）

本文用于指导 OpenClaw 在 Linpo「配对会话」模式下，稳定获取 `endpoint` 与 `gatewayToken` 并完成挂载。

## 目标

- 输入：`shortCode`、`name`、`attachApi`
- 输出：调用 `attachApi` 成功，Linpo 配对会话状态进入 `attached` 或 `bound`

## 固定流程

1. 读取当前 OpenClaw endpoint
- 先尝试读取可直接使用的地址候选：
  - `openclaw config get gateway.controlUi.allowedOrigins`
  - 若返回数组，优先使用其中的 `http://127.0.0.1:<port>` 或 `http://localhost:<port>`。
- 再读取端口与绑定信息：
  - `openclaw config get gateway.port`
  - `openclaw config get gateway.bind`
- 若仍无法确定 endpoint，则读取容器内 IP 并拼接：
  - `hostname -i | awk '{print $1}'`
  - 组合为：`http://<ip>:<gateway.port>`
- 注意：`gateway.endpoint` / `gateway.url` / `gateway.ws.url` 这些键可能不存在，出现 `Config path not found` 不算异常。

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

## Endpoint 选择规则（必须执行）

1. 在 OpenClaw 与 Linpo 同机部署时：
- 优先使用 `gateway.controlUi.allowedOrigins` 中包含端口的本地地址（如 `http://127.0.0.1:18789`）。

2. 在容器间互联场景（同一 Docker 网络）：
- 使用容器 IP + 端口（如 `http://172.xx.xx.xx:18789`）。

3. 若需跨主机访问：
- 使用 Linpo 部署网络内可达的网关地址（带协议与端口），优先内网地址，不使用仅容器内可达地址。

4. 若存在多个候选 endpoint：
- 选择“对 Linpo 可达”的那个；若无法判断，返回失败 JSON 并给出候选列表，不要猜测。

## 最小命令清单（可直接执行）

```bash
openclaw config get gateway.auth.token
openclaw config get gateway.port
openclaw config get gateway.bind
openclaw config get gateway.controlUi.allowedOrigins
hostname -i | awk '{print $1}'
```
