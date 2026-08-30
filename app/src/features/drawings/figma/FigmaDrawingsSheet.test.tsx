import { connectionsApi } from "@/api/connections";
import { figmaDrawingsApi } from "@/api/integrations/figma";
import { openProviderAuthorizationLink } from "@/shared/platform/openExternalLink";
import type * as OpenExternalLinkModule from "@/shared/platform/openExternalLink";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FigmaDrawingsSheet } from "./FigmaDrawingsSheet";
import { useFigmaDrawingsStore } from "./useFigmaDrawingsStore";

vi.mock("@/features/auth", () => ({ useAuth: () => ({ user: { id: "account-1" } }) }));
vi.mock("@/api/connections", () => ({
  connectionsApi: { list: vi.fn(), authorize: vi.fn(), remove: vi.fn() },
}));
vi.mock("@/api/integrations/figma", () => ({
  figmaDrawingsApi: { bindings: vi.fn(), records: vi.fn() },
  parseFigmaFileKey: vi.fn(() => ""),
}));
vi.mock("@/shared/platform/openExternalLink", async (importOriginal) => ({
  ...(await importOriginal<typeof OpenExternalLinkModule>()),
  openProviderAuthorizationLink: vi.fn(),
  openExternalLink: vi.fn(),
}));

describe("FigmaDrawingsSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFigmaDrawingsStore.getState().reset();
    vi.mocked(figmaDrawingsApi.bindings).mockResolvedValue({ bindings: [] });
    vi.mocked(figmaDrawingsApi.records).mockResolvedValue({ records: [] });
    vi.mocked(connectionsApi.authorize).mockResolvedValue({
      provider: "figma",
      authorization_url: "https://www.figma.com/oauth",
    });
  });
  afterEach(cleanup);

  it("mounts in Drawings and starts with least-privilege read consent in Misty Browser", async () => {
    vi.mocked(connectionsApi.list).mockResolvedValue({ connections: [] });
    render(<FigmaDrawingsSheet spaceId="space-1" canManage open onOpenChange={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Figma for Drawings" })).toBeTruthy();
    await waitFor(() => expect(connectionsApi.list).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() =>
      expect(connectionsApi.authorize).toHaveBeenCalledWith(
        "figma",
        ["drawings_read"],
        "/spaces/space-1/drawings",
      ),
    );
    expect(openProviderAuthorizationLink).toHaveBeenCalledWith("https://www.figma.com/oauth");
  });

  it("requests comments and live sync only as explicit incremental permissions", async () => {
    vi.mocked(connectionsApi.list).mockResolvedValue({
      connections: [
        {
          id: "connection-1",
          provider: "figma",
          account_display: "Designer",
          status: "active",
          capabilities: ["drawings_read"],
        },
      ],
    });
    render(<FigmaDrawingsSheet spaceId="space-1" canManage open onOpenChange={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Enable comments" }));
    await waitFor(() =>
      expect(connectionsApi.authorize).toHaveBeenCalledWith(
        "figma",
        ["drawings_read", "drawings_comments"],
        "/spaces/space-1/drawings",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Enable live sync" }));
    await waitFor(() =>
      expect(connectionsApi.authorize).toHaveBeenLastCalledWith(
        "figma",
        ["drawings_read", "drawings_webhooks"],
        "/spaces/space-1/drawings",
      ),
    );
    expect(screen.getByText(/must have Can edit access/i)).toBeTruthy();
  });
});
