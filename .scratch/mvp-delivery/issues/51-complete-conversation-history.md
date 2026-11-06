# 51 · 长历史与阅读导航完整性

Status: claimed
Type: task

## 范围

当前SessionView仅保留128消息，持久event_log有原始事件。不能仅提高内存上限来宣称完整历史。检查现有Storage与Projection，设计可分页查询的持久消息历史，兼容已有数据与重启。

## 验收

- 超过128消息后可加载更早历史，不能静默丢失；滚动位置保留，阅读导航覆盖已载入轮次。
- 流式chunk/snapshot、上游连接ID隔离、pending用户消息替换、Run/工具关联保持一致。
- 存储与事件提交保持一致；旧记录能回填的依据原始事件恢复，无法恢复处如实说明。
- 分页请求与快照/重连合并去重，旧响应不覆盖新会话，手机角色/工作区范围由服务端校验。
- 真实Host集成验证超128消息、分页、刷新/重启、流式继续与未授权读取；更新文档及数据流图。

## 实现方向

采用持久历史记录（消息和工具）以及独立分页接口，保留SessionView各128项的运行投影。每条记录有稳定historyOrder与historyRevision，客户端按身份、顺序、修订合并，旧响应不能盖掉新流式内容。被投影淘汰的记录在后续chunk到达前从档案恢复，防止从空字符串拼接丢失前文。

历史档案写入与Session/event_log同事务。首次升级按原始事件回放并保存断点，pending用户输入在上游接受后被真实user消息替换；遗留导出只有快照时明确可恢复范围，不伪造丢失历史。消息与工具共用分页游标，保持Run关联。详见待生成的 docs/conversation-history.md。

## 存储/回填实现细节（尚未实现）

- 消息与工具共用conversation_records，session内historyOrder唯一，按首次观察顺序分配；记录同时存historyRevision。pending用户输入被上游接受后沿用同一historyOrder，只更换消息ID与内容，避免分页中留下两个用户输入。SQL按(session,historyOrder) upsert，修订旧值不能覆盖新值。
- SessionView新增向后兼容的history_sequence。commit集中比较旧/新记录，新增者分配顺序，任何内容或pending变化都更新historyRevision；不能只在message事件更新修订，因为finish也会改变pending。
- 被消息/工具各128项投影淘汰的ID，更新前先从档案恢复，再apply chunk/snapshot。读取档案不把旧Run误归给当前Run。更新后维持有界投影，档案保留完整记录；text截断必须有标记。
- Store.save中档案写入与sessions/event_log/outbox同事务。新建空会话直接有complete标记；旧导入不根据客户端带来的historyOrder直接认为档案完整。
- 首次旧数据回放保留checkpoint（事件cursor、记录sequence、currentRun、active/observed状态、warning）。一次读取一个原始事件，缓存每32事件落盘，缓存上限仍128/128；切换Run前先落盘，防止旧重复ID在缓存覆盖。中断重启从同一checkpoint继续，不重复拼接chunk。
- 回放从run.started及现有Run元数据恢复尚未被上游接受的用户输入；真正user事件沿用pending顺序。历史完整性只能依据真实事件，legacy仅快照时给出说明。缺少过去文件内容时不读今天的工作区文件重造历史。
- 回填完成后保留保存的运行/恢复状态、lastActivityAt及业务revision，只更新结构化历史窗口/sequence；不能重放工具、审批或恢复Agent。现有重启活动时间相等测试须保留。
- HTTP历史页按historyOrder倒序查limit+1，再以正序返回records（message/tool），before为最老order，最多128/256条；同一Read授权与工作区限制。
- 前端合并以historyOrder身份和historyRevision为准，旧页不能盖新Snapshot。保留已看过的当前窗口，加载旧页只补充；WS重连同步已载入区间以补断线间隙。阅读位置用可见记录historyOrder+像素offset锚定，不能只按scrollHeight差（并发新消息会造成误移）。
- buildTurns现有工具循环在tool.runId不在messages时会误放legacy-tools，需改成有runId就创建对应Run；无runId才使用轮次未知组。导航应可到达所有已载入轮次，很多刻度时允许在索引内滚动。

需先实现并验证新档案/分页，再验证旧事件回填与客户端整合；本任务不以扩大数组上限作为完成。

### 关键简化与不变量

历史身份用session内唯一historyOrder，不以可变的上游messageId作为唯一分页身份。pending→实际user消息沿用相同order，SQLite按(session,historyOrder)冲突更新并替换source id；前端Map也按order合并，historyRevision更大者胜。这样旧pending页晚到不会复活重复消息，也不需要另一套删除tombstone接口。消息/工具都占用同一序列。

commit应集中为所有新增/变化记录分配order/revision（包括finish对pending的修改），不能只在有messageId/toolCallId的通知里打版本。实际user事件先从当前pending或档案pending找出要继承的order。新事件更新被淘汰ID时从档案恢复，再apply；保留原order后按下一业务revision更新版本。

回填每次读取一个原始事件，最多每32事件提交缓存和checkpoint，避免一批多张Base64图片造成峰值内存。run.started时可根据现有Run文本/附件生成尚未接受的输入（若最后快照已有pending ID则沿用），实际user事件替换；切换Run前提交，旧ID按Run边界隔离。只有旧快照而无早期事件时明确不能验证更早历史，不假装有完整日志。

回填完成后仍使用保存的业务状态/恢复状态，仅从档案重建最新128消息/128工具并保存sequence；不要把回放出来的active/approval状态应用到真实运行。archive SQL和完整标记的更新需同事务；新建空会话直接complete，旧导入必须先prepare。

前端缓存已见记录，初次只读取最近一页；加载更早记录按order游标。WS重连重新同步已载入的order范围（固定大小页循环），补齐离线窗口间隙并以版本合并；不丢掉原来正在看的历史。滚动锚点优先使用可见记录的historyOrder及相对像素offset，而非易受末尾流式追加影响的scrollHeight差。
