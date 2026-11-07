# 105 · Host跨平台持续集成

Status: claimed
Type: task
Blocked by: none

## 直接证据

27明确要求Host的Linux/Windows CI及平台差异，但当前仓库没有.github/workflows目录。批准原型控件复核未发现新占位入口；原生Mac锁屏、Claude未登录与物理手机验收仍需保留，不能用它们掩盖可实现的CI缺口。

## 验收

- GitHub Actions在Linux、Windows和macOS执行Host构建、Rust测试、共享契约/Node检查及隔离Host冒烟，不依赖本机凭据。
- 工作流固定工具链及第三方Action提交，最小只读权限，矩阵失败不取消其他平台，不发布未验收桌面安装包。
- 真实查看远程运行结果并处理失败；平台限制与未覆盖实机项目明确记录。
- 中文说明和验收证据更新，分阶段提交，不把CI通过冒充原生桌面或物理手机验收。

## Comments

已提交工作流与隔离Host冒烟（bdb6dc4），固定Action提交经远程tag核对，Rust版本与当前本机一致。首轮真实运行42319649009：Ubuntu 24.04和macOS 15完整通过；Windows 2022在严格契约漂移检查失败，未被跳过。

对Windows autocrlf的隔离Git模拟复现生成文件检出CRLF造成字节差异；新增.gitattributes固定文本LF，保留bat/cmd的CRLF。模拟确认带属性检出与原生成文件逐字相同，contracts:check仍通过，不放宽校验。修复已作为12e94b8单独推送，第二轮42320360173正在运行，等待实际Windows及全矩阵结果，不提前关闭105。

本机最终完整check为60项Node/SDK、workspace Rust（Workbench54、存储9）、47项Host与恢复通过；原生5项单元、严格Clippy与新增隔离Host冒烟12.6秒通过。原生CUA仍明确Mac locked，Claude只读状态false/none，实际用户Host健康且未操作。批准原型五个源码文件的控件已重新提取复核；尚未用自动检查代替原生/物理设备验收。

第二轮Linux/macOS通过，Windows生成契约校验已通过，随后作者CLI pack返回Invalid App entry。实际代码用`${realpath(root)}/`做App前缀比较，不适配Windows分隔符，输出目录范围检查也有同类假设。新增containsPackagePath，使用平台relative/isAbsolute判断，保留真实路径及普通文件检查；补充POSIX、盘符大小写/混合分隔符、UNC、相邻目录/父级/跨盘及实际CLI源包内输出拒绝回归。61项Node检查和追加作者CLI/范围2项检查通过，等待远程验证，105仍claimed。
