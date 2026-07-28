import { defineConfig } from "vitest/config";

// Pure-logic modules (ticket verification, projection signing, ACL decisions)
// use only standard WebCrypto and run identically under Node and workerd, so
// they are tested here without the Workers pool. Durable Object behaviour is
// covered separately by tests that need the real runtime.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
