import { invoke } from "./native.ts";
import { HostRequestError, type HostErrorPayload } from "./host-error.ts";

export interface HostConnection {
  url: string;
  token?: string;
  remote?: boolean;
  persistent?: boolean;
  dataDirectory?: string;
}

export const openExternal = (url: string): Promise<void> =>
  invoke("open_external", { url });

export const restartHost = () => invoke("restart_host");

export const isNative = (): boolean => Boolean(window.vibeoneDesktop);

export const connectHost = (): Promise<HostConnection> =>
  isNative()
    ? invoke("host_connection")
    : Promise.resolve({ url: location.origin, remote: true });

export const exportRemoteCertificate = () => invoke("export_remote_certificate");

export const chooseWorkspace = () => invoke("choose_workspace");

/** 向工作主机发送 HTTP 请求，并在非 2xx 时抛出标准化错误 */
export async function request<T = unknown>(
  connection: HostConnection,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${connection.url}/v1${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: connection.remote ? "include" : "omit",
    headers: {
      ...(connection.token
        ? { Authorization: `Bearer ${connection.token}` }
        : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal,
  });

  if (!response.ok) {
    if (connection.remote && response.status === 401) {
      window.dispatchEvent(new Event("vibeone-unpaired"));
    }
    const result = (await response
      .json()
      .catch(() => null)) as HostErrorPayload | null;
    throw new HostRequestError(response.status, result);
  }
  return (await response.json()) as T;
}
