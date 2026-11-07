# 127 · 统一输入菜单
Status: resolved
Type: task
Blocked by: none

管家/群组复用ComposerInput。@提供Agent候选，/采用单行列表分组，保留技能来源。普通对话和协作组明确区分成员提及与实际调度。

## Answer

先复现管家输入斜杠无菜单的失败，再统一管家/群组/普通Agent输入。新增Agent候选，单行菜单与来源分组；普通提及不跨Agent派发，组内提及经Host调度。输入工具测试16项通过，隔离群组@与斜杠菜单通过，未发送模型任务。
