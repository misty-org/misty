import assert from "node:assert/strict";
import { test } from "node:test";
import { publicAppEnv } from "./app-env.ts";

test("exposes only VITE_ names to the renderer", () => {
  const env = { VITE_LABEL: "App label", PRIVATE_KEY: "private-fixture", VITE_UNSET: undefined };
  assert.deepEqual(publicAppEnv(env), { "import.meta.env.VITE_LABEL": '"App label"' });
});
