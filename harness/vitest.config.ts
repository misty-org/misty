import { defineConfig } from "vitest/config";

// The page runtime's tests load the same scripts the hosts inject into jsdom.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    restoreMocks: true,
    setupFiles: ["./tests/setup.ts"],
  },
});
