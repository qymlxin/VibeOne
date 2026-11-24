import {
  configChoices,
  type AgentConfigOptionInput,
  type ConfigChoiceItem,
} from "./agent-config.ts";

export interface ModelSelectOption {
  value: string;
  label: string;
  description?: string;
}

/** 判断配置项是否为模型选择项 */
export const isModelOption = (option: AgentConfigOptionInput): boolean =>
  option.type === "select" &&
  (option.category === "model" || option.configId === "model");

/** 从同一 Provider/Profile 的最近会话中提取已保存的模型选项定义 */
export function savedModelOption(
  sessions:
    | Array<{
        provider: string;
        profile?: { id?: string | null } | null;
        lastActivityAt?: number;
        agentState?: { configOptions?: AgentConfigOptionInput[] } | null;
      }>
    | null
    | undefined,
  provider: string,
  profileId?: string | null,
): AgentConfigOptionInput | undefined {
  return [...(sessions ?? [])]
    .filter(
      (session) =>
        session.provider === provider &&
        (session.profile?.id ?? null) === (profileId ?? null),
    )
    .sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0))
    .flatMap((session) => session.agentState?.configOptions ?? [])
    .find(
      (option) => isModelOption(option) && configChoices(option).length > 0,
    );
}

/** 将模型配置项转换为下拉选择器选项 */
export function modelOptions(
  option?: AgentConfigOptionInput | null,
): ModelSelectOption[] {
  return configChoices(option ?? {}).map((item: ConfigChoiceItem) => ({
    value: item.value,
    label: item.name ?? item.value,
    description: item.group ?? item.description,
  }));
}
