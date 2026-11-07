# 已批准原型的生产副本

本目录直接迁入 Git 提交 `57bccce` 的批准原型，用于正式桌面。不要再另写一套桌面样式去近似它。

| 文件 | 原型来源 | 当前差异 |
| --- | --- | --- |
| review.css | prototype/src/review.css | 字节完全一致 |
| settings-review.css | prototype/src/settings-review.css | 字节完全一致 |
| Appearance.jsx | prototype/src/Appearance.jsx | 保留原组件结构；演示文案改为真实持久设置文案，恢复按钮添加原有无障碍名称 |

`ApprovedWorkbenchShell.jsx` 直接使用原型的 `review-app/windowbar/session-sidebar/chat-column/context-panel` 布局。业务组件继续绑定真实Host状态，模拟消息、配对码、分支和认证结果没有迁入正式页面。

`runtime-states.css` 只承接审批、历史恢复、输入建议、错误重试等真实业务状态及接口控件的样式。旧的手机样式单独保存在 `legacy-phone.css`，仅在800px以下加载；已删除旧桌面的三份竞争布局样式。

`FilePanel.jsx` 从同一提交 `review.jsx` 的右侧文件面板 JSX 提取：保留 `file-tabbar` / `file-toolbar` / `file-tree` / `tree-heading` / `tree-folder` / `tree-file` 的结构、SVG和原CSS。将固定files数组替换为真实目录节点及Git文件列表，将演示onClick替换为读取/折叠回调。只有多层目录增加相应缩进；刷新、输入目录和保存产物放在原型分支按钮打开的操作菜单里，不再常驻改写原型工具栏。

用户在112中要求调整文件图标与差异色调：FilePanel保留原型层级，类型图标由FileTypeIcon共用组件提供，变更树增加状态标记与统计。新增差异视觉样式放在diff-treatment.css，排在原型样式后加载，避免CSS层级抵消配色和宽度；不改动原型review.css。
