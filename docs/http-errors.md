# HTTP错误契约

桌面和手机共用同一种HTTP失败信封。业务接口、鉴权、路由和请求解析的4xx/5xx均输出JSON；成功的JSON、文件内容与WS升级保持原来格式。`features`中的`structuredErrors`表示主机支持此契约。

```json
{
  "code": "CONFLICT",
  "error": "同一幂等键的插件操作内容不同",
  "status": 409,
  "requestId": "a3ae0841-73a6-41df-b14e-fc45ff450830"
}
```

以上是格式示例。code为不超过128字节的非空ASCII标识，供程序分支判断；error保留接口原有中文说明；status与实际HTTP状态一致。已有专用码（例如OPERATION_NOT_FOUND）不被通用码覆盖。其他请求解析失败使用中文通用指引，不回显框架的原始页面。

## 通用码

| HTTP状态 | 通用code | 含义 |
| --- | --- | --- |
| 400 | INVALID_REQUEST | 请求格式、参数或当前业务输入不符合要求 |
| 401 | UNAUTHENTICATED | 未配对、凭据过期或已撤销 |
| 403 | FORBIDDEN | 来源、角色或范围不允许 |
| 404 | NOT_FOUND | 接口或记录不存在；专用码优先 |
| 405 | METHOD_NOT_ALLOWED | 不支持此请求方法 |
| 408 | REQUEST_TIMEOUT | 请求等待超时 |
| 409 | CONFLICT | 幂等内容、修订或决定冲突 |
| 413 | PAYLOAD_TOO_LARGE | 当前接口请求正文超过限制 |
| 415 | UNSUPPORTED_MEDIA_TYPE | 请求内容类型不符合要求 |
| 422 | VALIDATION_FAILED | JSON字段类型或结构不符合要求 |
| 429 | RATE_LIMITED | 请求频率超限 |
| 500 | INTERNAL_ERROR | 主机服务内部失败 |
| 502 / 503 / 504 | UPSTREAM_UNAVAILABLE / SERVICE_UNAVAILABLE / UPSTREAM_TIMEOUT | 上游或主机暂时不可用/超时 |

未单独列出的5xx使用INTERNAL_ERROR，其他失败状态使用REQUEST_FAILED。此票保留原有业务HTTP状态；尚未将全部内部Result&lt;_, String&gt;替换为领域错误枚举，因此部分“记录不存在”等业务校验仍由旧入口返回400，不能宣称已有完整领域错误分类。

## 响应身份与兼容

每次API响应由主机生成requestId，错误JSON和`x-vibeone-request-id`响应头使用同一值，不接受客户端指定的身份。它用于区分本次响应，不是持久操作回执；不提供按requestId查询历史的接口。后台操作仍用operationId对账。

失败信封由Rust `ErrorResponse` DTO序列化，保留Allow、Retry-After等原响应头，重算JSON内容类型及长度，并禁止缓存错误。仅输出约定字段，说明最多4000字符；令牌、Cookie、请求正文和响应对象的其他字段不加入错误身份。未知API路径单独返回API错误，不落入手机SPA页面回退。

客户端统一抛出HostRequestError，保留status、code和requestId；实际HTTP状态优先于正文自报status。旧主机没有code时按HTTP状态补通用码，仍保留原说明；未知新码原样保留，不把中文说明解析成程序条件。无效/非JSON旧错误使用通用说明。401的手机退出配对行为不变。

## 验证

真实Host检查401/403、404/405、400非法JSON与查询、415、422、413、409及专用404码；错误身份每次不同且与响应头一致，成功快照保持原结构。真实HTTP服务检查503、Retry-After保留及未知字段剔除。客户端检查旧格式、未知码、无效字段和实际状态优先。

桌面完整交互与HTTPS手机回归继续核对消息、附件字节、人工处理、插件、游标恢复及撤销；手机未知API路径检查确保返回授权错误JSON，不能返回页面HTML。此契约是14的一部分，业务DTO生成和全部领域错误替换仍独立待交付。
