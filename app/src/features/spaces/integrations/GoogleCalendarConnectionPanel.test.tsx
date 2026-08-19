import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  integrations: vi.fn(),
  bindAccountConnection: vi.fn(),
  list: vi.fn(),
  authorize: vi.fn(),
  openExternalLink: vi.fn(),
}));

vi.mock("@/api/spaces/api", () => ({
  spacesApi: {
    integrations: mocks.integrations,
    bindAccountConnection: mocks.bindAccountConnection,
  },
}));
vi.mock("@/api/connections", () => ({
  connectionsApi: { list: mocks.list, authorize: mocks.authorize },
}));
vi.mock("@/shared/platform/openExternalLink", () => ({
  openExternalLink: mocks.openExternalLink,
}));

import { GoogleCalendarConnectionPanel } from "./GoogleCalendarConnectionPanel";

describe("GoogleCalendarConnectionPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.clearAllMocks();
    mocks.integrations.mockResolvedValue({
      integrations: [],
      providers: [{ provider: "google", configured: true }],
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("reuses a Google account that already has Calendar write access", async () => {
    mocks.list.mockResolvedValue({
      connections: [
        {
          id: "connection-1",
          provider: "google",
          account_display: "owner@example.com",
          status: "active",
          capabilities: ["mail", "calendar_write"],
        },
      ],
    });
    mocks.bindAccountConnection.mockResolvedValue({
      integration: { id: "integration-1", provider: "google", status: "active" },
      connection_id: "connection-1",
      capability: "calendar_write",
    });

    await renderPanel(root);
    await click(buttonNamed(container, "Connect"));

    expect(mocks.bindAccountConnection).toHaveBeenCalledWith(
      "space-1",
      "google",
      "connection-1",
      "calendar_write",
    );
    expect(mocks.authorize).not.toHaveBeenCalled();
  });

  it("requests incremental Calendar write consent when it is not granted", async () => {
    mocks.list.mockResolvedValue({ connections: [] });
    mocks.authorize.mockResolvedValue({
      authorization_url: "https://accounts.google.test/consent",
    });

    await renderPanel(root);
    await click(buttonNamed(container, "Connect"));

    expect(mocks.authorize).toHaveBeenCalledWith(
      "google",
      ["calendar_write"],
      "/spaces/space-1/settings/connections",
    );
    expect(mocks.openExternalLink).toHaveBeenCalledWith("https://accounts.google.test/consent");
    expect(mocks.bindAccountConnection).not.toHaveBeenCalled();
  });
});

async function renderPanel(root: Root) {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <GoogleCalendarConnectionPanel spaceId="space-1" canManage />
      </MemoryRouter>,
    );
  });
}

async function click(element: Element | null) {
  expect(element).not.toBeNull();
  await act(async () => {
    element!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function buttonNamed(container: HTMLElement, name: string) {
  return Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === name,
  )!;
}
