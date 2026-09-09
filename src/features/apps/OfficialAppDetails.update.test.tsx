import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OfficialAppDetails } from "./OfficialAppDetails";
import { useAppsStore } from "./useAppsStore";
import { useAppConsent } from "./useAppConsent";
import type { OfficialApp, SpaceAppInstallation } from "@/api/apps";
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => false }));
afterEach(cleanup);
it("offers Update for a downloaded app with an older Space release and applies it after consent", async () => {
  const app = {
    id: "agents",
    name: "Agents",
    publisher: "Misty",
    version: "1.1.1",
    permission_version: 1,
    scopes: [],
    desktop: { runtime: "downloaded" },
    mobile: { runtime: "hosted" },
    description: "Agents",
    official: true,
    minimum_host_protocol: 1,
    age_rating: "4+",
  } as OfficialApp;
  const installation = {
    app_id: "agents",
    space_id: "family",
    state: "installed",
    installed_version: "1.1.0",
    permission_version: 1,
    granted_scopes: [],
  } as unknown as SpaceAppInstallation;
  useAppsStore.setState({
    accountId: "test",
    spaceId: "family",
    bySpace: { family: [installation] },
    prefetchSpaceAccess: async () => {},
  });
  useAppConsent.setState({ agreed: {} });
  const install = vi.fn().mockResolvedValue(undefined);
  render(
    <OfficialAppDetails
      app={app}
      installation={installation}
      actionAppId=""
      mobile={false}
      error=""
      onClose={vi.fn()}
      onRestoreFocus={vi.fn()}
      onInstall={install}
      onRemove={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Update" }));
  expect(install).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Agree and update" }));
  await waitFor(() => expect(install).toHaveBeenCalledExactlyOnceWith(app));
});
