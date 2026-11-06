import { invoke } from "@tauri-apps/api/core";

export const restartHost = () => invoke("restart_host");
export const connectHost = () => invoke("host_connection");
export const chooseWorkspace = () => invoke("choose_workspace");

export async function request(connection, path, body, signal) {
  const response = await fetch(`${connection.url}/v1${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${connection.token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal,
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(
      result?.error ?? `请求未成功（${response.status}），请检查主机连接`,
    );
  }
  return response.json();
}
