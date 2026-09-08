import { Buffer } from "buffer";

// Midscene is written for Node: it reads process.env and uses Buffer when it
// loads, and the app's web view has neither. An empty env is enough (its model
// settings come from screenModelConfig). Imported before Midscene so it runs first.
const scope = globalThis as {
  process?: { env?: Record<string, string | undefined> };
  Buffer?: typeof Buffer;
};
scope.process ??= { env: {} };
scope.process.env ??= {};
scope.Buffer ??= Buffer;
