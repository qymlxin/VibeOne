import { invoke } from "./native.js";
import { HostRequestError } from "./host-error.js";

export const openExternal = url => invoke("open_external", {url});

export const restartHost = () => invoke("restart_host");
export const isNative = () => !!(window.__TAURI_INTERNALS__||window.vibeoneDesktop);
export const connectHost = () =>
  isNative()
    ? invoke("host_connection")
    : Promise.resolve({ url: location.origin, remote: true });
export const exportRemoteCertificate = () =>
  invoke("export_remote_certificate");
export const chooseWorkspace = () => invoke("choose_workspace");

export async function request(connection, path, body, signal) {
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
    if (connection.remote && response.status === 401)
      window.dispatchEvent(new Event("vibeone-unpaired"));
    const result = await response.json().catch(() => null);
    throw new HostRequestError(response.status,result);
  }
  return response.json();
}
