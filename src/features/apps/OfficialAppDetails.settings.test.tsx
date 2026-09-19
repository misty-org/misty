import { MemoryRouter } from "react-router-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { OfficialApp, SpaceAppInstallation } from "@/api/apps";
import { apiRequest } from "@/api/client";
import type * as Client from "@/api/client";
import { OfficialAppDetails } from "./OfficialAppDetails";

vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => false }));
vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof Client>()),
  apiRequest: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it.each(["installed", "recoverable"] as const)(
  "keeps account selection and previous-Space exports out of %s app details",
  (state) => {
    const app = {
      id: "inbox",
      name: "Inbox",
      publisher: "Misty",
      version: "1.0.0",
      permission_version: 1,
      scopes: ["connections.read"],
      desktop: { runtime: "downloaded" },
      mobile: { runtime: "hosted" },
      description: "Your inbox",
      official: true,
      minimum_host_protocol: 1,
      age_rating: "4+",
    } as OfficialApp;
    const installation = {
      app_id: app.id,
      state,
      installed_version: app.version,
      permission_version: app.permission_version,
      granted_scopes: app.scopes,
    } as SpaceAppInstallation;
    render(
      <MemoryRouter>
        <OfficialAppDetails
          app={app}
          installation={installation}
          actionAppId=""
          mobile={false}
          error=""
          onClose={vi.fn()}
          onRestoreFocus={vi.fn()}
          onInstall={vi.fn()}
          onRemove={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByText("Your accounts for this app")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save your selection" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Export data from previous Spaces/ })).toBeNull();
    expect(screen.getByText(/Choose which agents can use it in agent settings/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: state === "installed" ? "Open" : "Install" }),
    ).toBeTruthy();
    expect(apiRequest).not.toHaveBeenCalled();
  },
);
