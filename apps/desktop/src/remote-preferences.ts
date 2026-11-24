export interface RemoteStateInput {
  url?: string | null;
  suggestedIp?: string | null;
  configuration?: {
    ip?: string | null;
    port?: number | null;
  } | null;
}

export interface RemoteDeviceInput {
  id?: string | null;
  name?: string | null;
  role?: string | null;
  status?: string | null;
  revoked?: boolean;
  expiresAt?: number | null;
  workspaces?: unknown;
}

/** 提取远程访问表单所需的 IP 与端口首选项 */
export function remotePreferences(state?: RemoteStateInput | null): {
  ip: string;
  port: string;
} {
  const configuration = state?.configuration;
  let address: URL | undefined;
  try {
    if (state?.url) {
      address = new URL(state.url);
    }
  } catch {
    // URL 解析失败时回退到已确认配置
  }
  const savedPort = configuration?.port;
  return {
    ip:
      address?.hostname.replace(/^\[|\]$/g, "") ||
      configuration?.ip ||
      state?.suggestedIp ||
      "",
    port: String(
      typeof savedPort === "number" &&
        Number.isInteger(savedPort) &&
        savedPort >= 0 &&
        savedPort <= 65535
        ? savedPort
        : address?.port || 0,
    ),
  };
}

const roles: Record<string, string> = {
  viewer: "仅查看",
  approver: "查看与审批",
  operator: "查看、操作与审批",
};

const statuses: Record<string, string> = {
  active: "已授权",
  expired: "已过期",
  revoked: "已撤销",
  invalid: "记录异常",
};

/** 规整已配对远程设备的展示信息与状态标签 */
export function devicePresentation(
  device: RemoteDeviceInput,
  workspaces: Array<{ id: string; name: string }> = [],
  timestamp = Date.now() / 1000,
): {
  id: string | null;
  name: string;
  status: string;
  label: string;
  role: string;
  expires: string | null;
  scopes: string[];
} {
  const id =
    typeof device.id === "string" && device.id.length ? device.id : null;
  const knownRole =
    typeof device.role === "string" && Object.hasOwn(roles, device.role)
      ? (roles[device.role] ?? null)
      : null;
  const validScopes =
    Array.isArray(device.workspaces) &&
    device.workspaces.length > 0 &&
    device.workspaces.every(
      (item) => typeof item === "string" && item.length > 0,
    );
  const scopes = Array.isArray(device.workspaces)
    ? device.workspaces.filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      )
    : [];

  // 优先信任工作主机返回的设备状态，避免客户端时钟偏差导致误判
  const status =
    typeof device.status === "string" && Object.hasOwn(statuses, device.status)
      ? device.status
      : device.revoked === true
        ? "revoked"
        : !id ||
            !knownRole ||
            !validScopes ||
            device.revoked !== false ||
            typeof device.expiresAt !== "number" ||
            !Number.isFinite(device.expiresAt)
          ? "invalid"
          : device.expiresAt <= timestamp
            ? "expired"
            : "active";

  const date =
    typeof device.expiresAt === "number"
      ? new Date(device.expiresAt * 1000)
      : null;
  return {
    id,
    name: typeof device.name === "string" && device.name ? device.name : "未命名设备",
    status,
    label: statuses[status] ?? "未知状态",
    role: knownRole ?? "未知角色",
    expires:
      date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : null,
    scopes: scopes.map(
      (scopeId) =>
        workspaces.find((workspace) => workspace.id === scopeId)?.name ??
        `未找到的工作区（${scopeId}）`,
    ),
  };
}
