export interface ConfigChoiceItem {
  value: string;
  name?: string;
  description?: string;
  group?: string;
}

export interface AgentConfigOptionInput {
  type?: string;
  configId?: string;
  category?: string;
  name?: string;
  description?: string;
  currentValue?: string | boolean;
  options?: Array<{
    value?: string;
    name?: string;
    groupId?: string;
    options?: Array<{ value?: string; name?: string; description?: string }>;
  }>;
}

/** 展平 Agent 配置选项中的可选择项 */
export function configChoices(
  option: AgentConfigOptionInput,
): ConfigChoiceItem[] {
  if (option.type !== "select" || !Array.isArray(option.options)) {
    return [];
  }
  return option.options.flatMap((group) => {
    if (Array.isArray(group.options)) {
      return group.options
        .filter((item): item is ConfigChoiceItem => typeof item.value === "string")
        .map((item) => ({
          ...item,
          group: group.name ?? group.groupId,
        }));
    }
    return typeof group.value === "string"
      ? [group as ConfigChoiceItem]
      : [];
  });
}

/** 判断当前会话是否处于允许修改 Agent 配置的状态 */
export function canConfigure(
  session: {
    agentState?: { contextRestoreState?: string } | null;
    historyOnly?: boolean;
    archived?: boolean;
    queue?: unknown[];
    status: string;
  },
  workbench: {
    phase: string;
    device?: { role?: string | null } | null;
  },
): boolean {
  return (
    !["pending", "restoring"].includes(
      session.agentState?.contextRestoreState ?? "",
    ) &&
    workbench.phase === "online" &&
    !session.historyOnly &&
    !session.archived &&
    !(session.queue?.length) &&
    ![
      "starting",
      "running",
      "requires_action",
      "cancelling",
      "disconnected",
    ].includes(session.status) &&
    (!workbench.device || workbench.device.role === "operator")
  );
}
