import type { OfficialApp } from "@/api/apps";

// Identity allowlist only. Downloaded code additionally requires native signature
// and extracted-file verification before it can join the desktop React tree.
const identities = {
  chat: "com.misty.social",
  journal: "com.misty.journal",
  planner: "com.misty.planner",
  library: "com.misty.library",
  inbox: "com.misty.inbox",
  agents: "com.misty.agents",
  files: "com.misty.files",
  browser: "com.misty.browser",
  code: "com.misty.code",
  terminal: "com.misty.terminal",
} as const;

export type TrustedHostAppId = keyof typeof identities;

export function isTrustedHostApp(app: OfficialApp): boolean {
  return (
    app.official === true &&
    app.publisher === "Misty" &&
    Object.prototype.hasOwnProperty.call(identities, app.id) &&
    app.app_id === identities[app.id as TrustedHostAppId]
  );
}
