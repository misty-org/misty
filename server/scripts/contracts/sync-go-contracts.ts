import { execFileSync } from "node:child_process";

// Phase 1 removed the frontend capability definitions. The retained contracts
// now belong to Go and are consumed directly by the workflow runtime; validate
// those canonical schemas instead of importing the retired frontend catalog.
execFileSync("go", ["test", "./internal/capabilities", "./internal/agenttools"], {
  cwd: new URL("../../", import.meta.url),
  stdio: "inherit",
});
