import { useEffect, useState, useCallback, useRef } from "react";
import { connectHost, restartHost, request } from "./api.js";

export function useWorkbench() {
  const [connection, setConnection] = useState(null);
  const [snapshot, setSnapshot] = useState({ providers: [], sessions: [] });
  const [phase, setPhase] = useState("connecting");
  const [error, setError] = useState("");
  const refreshRef = useRef(async () => {});
  const upgrading = useRef(false);
  const reconnect = useCallback(async () => {
    setPhase("connecting");
    setError("");
    try {
      setConnection(await connectHost());
    } catch (error) {
      setError(String(error));
      setPhase("offline");
    }
  }, []);
  const restart = useCallback(async () => {
    upgrading.current = true;
    setPhase("upgrading");
    setError("");
    setConnection(null);
    try {
      setConnection(await restartHost());
    } catch (error) {
      setError(String(error));
      setPhase("offline");
    } finally {
      upgrading.current = false;
    }
  }, []);
  useEffect(() => {
    void reconnect();
  }, [reconnect]);
  useEffect(() => {
    if (!connection) return;
    let closed = false,
      socket,
      retry,
      debounce;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const next = await request(
          connection,
          "/snapshot",
          undefined,
          controller.signal,
        );
        if (!closed)
          setSnapshot((current) =>
            current.revision > next.revision ? current : next,
          );
      } catch (error) {
        if (!closed && !upgrading.current) setError(error.message);
      }
    };
    // A new Host has a different revision space; discard the old in-memory projection.
    setSnapshot({ providers: [], sessions: [] });
    refreshRef.current = refresh;
    const open = () => {
      socket = new WebSocket(
        `${connection.url.replace(/^http/, "ws")}/v1/events`,
      );
      socket.onopen = () =>
        socket.send(JSON.stringify({ token: connection.token }));
      socket.onmessage = (event) => {
        if (closed || upgrading.current) return;
        const message = JSON.parse(event.data);
        if (message.type === "ready") {
          setPhase("online");
          setError("");
          void refresh();
        } else if (!debounce)
          debounce = setTimeout(() => {
            debounce = null;
            void refresh();
          }, 60);
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (!closed && !upgrading.current) {
          setPhase("reconnecting");
          void refresh();
          retry = setTimeout(open, 1500);
        }
      };
    };
    open();
    return () => {
      closed = true;
      clearTimeout(retry);
      clearTimeout(debounce);
      controller.abort();
      socket?.close();
    };
  }, [connection]);
  const call = useCallback(
    async (path, body) => {
      if (!connection || phase !== "online")
        throw new Error("主机未连接，请先重新连接");
      const result = await request(connection, path, body);
      await refreshRef.current();
      return result;
    },
    [connection, phase],
  );
  const read=useCallback(async(path,signal)=>{if(!connection||phase!=='online')throw Error('主机未连接');return request(connection,path,undefined,signal);},[connection,phase]);
  return { ...snapshot, dataDirectory:connection?.dataDirectory, migrationPending:!!connection?.migrationPending, migrationWarning:connection?.migrationWarning, phase, error, call, read, reconnect, restart };
}
