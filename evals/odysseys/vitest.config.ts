import { defineConfig } from "vitest/config";

// Unit tests only: they use a local mock and never reach a model or a Misty stack.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/*.test.ts"],
  },
});
