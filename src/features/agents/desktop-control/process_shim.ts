import { Buffer } from "buffer";

const scope = globalThis as {
  process?: { env?: Record<string, string | undefined> };
  Buffer?: typeof Buffer;
};
scope.process ??= { env: {} };
scope.process.env ??= {};
scope.Buffer ??= Buffer;
