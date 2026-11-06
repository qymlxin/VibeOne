#!/usr/bin/env node
import { Console } from 'node:console';
import { PluginEngine } from './engine.js';
import { RpcPeer } from './rpc.js';

// stdout is reserved for protocol frames; ordinary plugin console output goes to stderr.
globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });
const peer = new RpcPeer(process.stdin, process.stdout);
const engine = new PluginEngine(peer);
process.stdout.on('error', error => peer.close(error));
try {
  await peer.run(request => engine.dispatch(request));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  const deadline = setTimeout(() => process.exit(1), 2_000);
  await engine.close();
  clearTimeout(deadline);
  // Trusted plugin timers must not keep an orphan runner alive after Host disconnects.
  process.exit(process.exitCode ?? 0);
}
