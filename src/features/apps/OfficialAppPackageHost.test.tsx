import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { OfficialApp, OfficialAppSession } from "@/api/apps";
import type { NativeAppViewProps } from "./NativeAppView";
import { OfficialAppPackageHost } from "./OfficialAppPackageHost";

let latest: NativeAppViewProps;
vi.mock("./NativeAppView", () => ({
  NativeAppView: (props: NativeAppViewProps) => {
    latest = props;
    return <div>Native view</div>;
  },
}));
afterEach(cleanup);
const app = {
  id: "journal",
  app_id: "com.misty.journal",
  name: "Journal",
  version: "1",
  scopes: ["spaces.read"],
  official: true,
} as OfficialApp;
const session = {
  token: "secret-app-token",
  app_id: "journal",
  space_id: "s",
  scopes: app.scopes,
  expires_at: "2099-01-01T00:00:00Z",
} as OfficialAppSession;
function setup() {
  return render(
    <OfficialAppPackageHost
      app={app}
      session={session}
      source={new URL("misty-extension://localhost/public/journal/web/index.html")}
      serverBase="https://api.mistysys.com/v1"
      apiBase="https://api.mistysys.com/v1/app-runtime"
      user={{ id: "u", name: "Name", email: "private@example.com" }}
      route="/apps/journal"
      search="?space=s"
    />,
  );
}
it("opens a native view and sends only the public context", () => {
  const view = setup();
  expect(view.container.querySelector("iframe")).toBeNull();
  expect(latest.source).toContain("mistyAppInstance=");
  const context = JSON.stringify(latest.context);
  expect(context).not.toContain(session.token);
  expect(context).not.toContain("api.mistysys.com");
  expect(context).not.toContain("private@example.com");
  expect(latest.context).toMatchObject({ props: { user: { id: "u" }, settingsDocument: {} } });
});
it("derives capability identity from the owning view registration", async () => {
  setup();
  const signal = new AbortController().signal;
  expect(
    await latest.onRequest(
      {
        method: "context.get",
        appId: "another-app",
        params: { appId: "another-app" },
      },
      signal,
    ),
  ).toMatchObject({ appId: "com.misty.journal" });
  await expect(latest.onRequest({ command: "ensure_local_access_token" }, signal)).rejects.toThrow(
    "capability API",
  );
  await expect(latest.onRequest({ method: "terminal_create" }, signal)).rejects.toThrow(
    "does not support",
  );
});
