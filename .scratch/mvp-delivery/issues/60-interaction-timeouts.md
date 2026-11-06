# 60 · 人工请求超时回归

Status: resolved
Type: task

## 范围

通过真实stdio ACP演示进程，将权限及补充输入请求置于等待，再推进Tokio可控时钟经过现有600秒超时，验证请求解除、取消结果和旧请求拒绝处理。仅测试依赖启用test-util，不增加生产配置或缩短真实审批时限。

## Answer

真实stdio请求进入等待后，暂停Tokio时钟并推进601秒，再恢复时钟。权限请求发出permission_resolved且没有选择；结构化输入发出input_resolved。原有合法允许选项和合法表单答案此后均被拒绝，Agent收到取消结果并正常结束该轮。未用墙钟等待，也未替换生产分支或缩短其600秒时限。

该回归0.24秒通过；Agent客户端全5项测试与Clippy通过。test-util仅为dev-dependency，不改变生产配置。README补充已由本机CLI help核对的认证入口；未执行登录或修改凭据。
