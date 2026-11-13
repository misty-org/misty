import { expect, it } from "vitest";
import { createDefaultWorkspaceView } from "./workspaceDefaultView";
it("opens every new tab in Agents", () => {
  expect(createDefaultWorkspaceView()).toMatchObject({
    surfaceId: "agents",
    route: "/agents",
    placeholder: true,
  });
});
it("allocates independent identities", () => {
  const first = createDefaultWorkspaceView(),
    second = createDefaultWorkspaceView();
  expect(first.surfaceId).toBe("agents");
  expect(first.id).not.toBe(second.id);
  expect(first.instanceKey).not.toBe(second.instanceKey);
});
