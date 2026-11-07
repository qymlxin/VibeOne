# 已批准原型的生产副本

本目录直接迁入 Git 提交 `57bccce` 的批准原型，用于正式桌面。不要再另写一套桌面样式去近似它。

| 文件 | 原型来源 | 当前差异 |
| --- | --- | --- |
| review.css | prototype/src/review.css | 字节完全一致 |
| settings-review.css | prototype/src/settings-review.css | 字节完全一致 |
| Appearance.jsx | prototype/src/Appearance.jsx | 保留原组件结构；演示文案改为真实持久设置文案，恢复按钮添加原有无障碍名称 |

`ApprovedWorkbenchShell.jsx` 直接使用原型的 `review-app/windowbar/session-sidebar/chat-column/context-panel` 布局。业务组件继续绑定真实Host状态，模拟消息、配对码、分支和认证结果没有迁入正式页面。

`runtime-states.css` 只承接审批、历史恢复、输入建议、错误重试等真实业务状态及接口控件的样式。旧的手机样式单独保存在 `legacy-phone.css`，仅在800px以下加载；已删除旧桌面的三份竞争布局样式。
