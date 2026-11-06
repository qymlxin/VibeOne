import { copyFile } from "node:fs/promises";
// Keep the demonstrator Provider on the same ACP fixture used by the integration suite.
await copyFile(
  new URL("../crates/agent-client/fixtures/demo-agent.mjs", import.meta.url),
  new URL("../examples/plugins/workspace-tools/dist/demo-agent.mjs", import.meta.url),
);
