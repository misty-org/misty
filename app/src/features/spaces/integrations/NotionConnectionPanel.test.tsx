import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  integrations: vi.fn(),
  sharedProviderResources: vi.fn(),
  availableProviderResources: vi.fn(),
  selectProviderResources: vi.fn(),
  beginProviderConnection: vi.fn(),
  deleteProviderIntegration: vi.fn(),
}));
vi.mock("@/api/spaces/api", () => ({ spacesApi: api }));
vi.mock("@/shared/platform/openExternalLink", () => ({ openExternalLink: vi.fn() }));
import { NotionConnectionPanel } from "./NotionConnectionPanel";

describe("NotionConnectionPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    api.integrations.mockResolvedValue({
      integrations: [integration("active")],
      providers: [{ provider: "notion", configured: true }],
    });
    api.sharedProviderResources.mockResolvedValue({ resources: [sharedResource()] });
    api.availableProviderResources.mockResolvedValue({ resources: [availableResource()] });
    api.selectProviderResources.mockResolvedValue({ resources: [sharedResource()] });
    api.beginProviderConnection.mockResolvedValue({ authorization_url: "https://notion.example" });
    api.deleteProviderIntegration.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("reads and writes the Space's server-selected Notion resources", async () => {
    const onResourcesChanged = vi.fn();
    await act(async () => {
      root.render(
        <NotionConnectionPanel
          spaceId="space-1"
          canManage
          expandedByDefault
          onResourcesChanged={onResourcesChanged}
        />,
      );
    });
    await vi.waitFor(() => expect(buttonNamed(container, "Choose sources")).toBeDefined());

    await click(buttonNamed(container, "Choose sources"));
    await vi.waitFor(() => expect(container.textContent).toContain("Product specs"));
    await click(buttonNamed(container, "Save sources"));

    expect(api.selectProviderResources).toHaveBeenCalledWith("space-1", "integration-1", [
      { resource_type: "page", external_resource_id: "page-1" },
    ]);
    expect(onResourcesChanged).toHaveBeenCalledOnce();
    await click(buttonNamed(container, "Disconnect"));
    expect(api.deleteProviderIntegration).toHaveBeenCalledWith("integration-1");
  });

  it("offers reconnect and disconnect from Journal management", async () => {
    api.integrations.mockResolvedValue({
      integrations: [integration("needs_attention")],
      providers: [{ provider: "notion", configured: true }],
    });
    await act(async () => {
      root.render(<NotionConnectionPanel spaceId="space-1" canManage expandedByDefault />);
    });
    await vi.waitFor(() => expect(buttonNamed(container, "Reconnect")).toBeDefined());
    await click(buttonNamed(container, "Reconnect"));
    expect(api.beginProviderConnection).toHaveBeenCalledWith(
      "space-1",
      "notion",
      "/spaces/space-1/notes",
    );
  });
});

async function click(element: Element | undefined) {
  expect(element).toBeDefined();
  await act(async () => {
    element!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function buttonNamed(container: HTMLElement, name: string) {
  return Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === name,
  );
}

function integration(status: string) {
  return {
    id: "integration-1",
    space_id: "space-1",
    provider: "notion",
    display_name: "Misty workspace",
    granted_permissions: [],
    status,
    connected_by_user_id: "user-1",
    created_at: "2026-08-19T00:00:00Z",
    updated_at: "2026-08-19T00:00:00Z",
  };
}

function availableResource() {
  return {
    provider: "notion" as const,
    resource_type: "page" as const,
    external_resource_id: "page-1",
    display_name: "Product specs",
    configuration: {},
  };
}

function sharedResource() {
  return {
    ...availableResource(),
    id: "resource-1",
    space_id: "space-1",
    integration_id: "integration-1",
    status: "active",
    created_at: "2026-08-19T00:00:00Z",
    updated_at: "2026-08-19T00:00:00Z",
  };
}
