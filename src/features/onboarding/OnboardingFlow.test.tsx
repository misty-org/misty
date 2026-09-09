import type * as Lifecycle from "@/telemetry/lifecycle";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  catalog: vi.fn(),
  templates: vi.fn(),
  personal: vi.fn(),
}));
vi.mock("@/api/spaces/api", () => ({
  spacesApi: { create: mocks.create, templates: mocks.templates },
}));
vi.mock("@/api/apps", () => ({ appsApi: { catalog: mocks.catalog } }));
vi.mock("@/api/spaces/templates", () => ({ personalSpaceTemplatesApi: { list: mocks.personal } }));
vi.mock("@/features/auth", () => ({ useAuth: () => ({ user: { id: "account-1" } }) }));
vi.mock("@/telemetry/lifecycle", async (original) => ({
  ...(await original<typeof Lifecycle>()),
  trackOnboardingCompleted: vi.fn(),
}));
vi.mock("@/features/activity", () => ({ reportSystemError: vi.fn() }));
import { useSpacesStore } from "@/features/spaces/core";
import { markAccountCreating } from "./onboardingState";
import { OnboardingFlow } from "./OnboardingFlow";
let root: Root, container: HTMLDivElement;
async function click(text: string) {
  const button = [...document.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === text,
  );
  expect(button, text).toBeDefined();
  await act(async () => button!.click());
}
async function name(value: string) {
  const input = document.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  sessionStorage.clear();
  markAccountCreating("account-1");
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({ space: { id: "new-space" } });
  mocks.catalog.mockResolvedValue({
    apps: [
      {
        id: "journal",
        name: "Journal",
        scopes: ["notes.read"],
        permission_version: 3,
        requires_apps: [],
      },
    ],
  });
  mocks.templates.mockResolvedValue({
    templates: [
      { id: "blank", name: "Blank", app_ids: [] },
      { id: "family", name: "Family", app_ids: ["journal"] },
    ],
  });
  mocks.personal.mockResolvedValue({ templates: [] });
  useSpacesStore.setState({
    spaces: [],
    snapshotReady: true,
    clearError: vi.fn(),
    load: vi.fn(async () => undefined) as never,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <MemoryRouter>
        <OnboardingFlow />
      </MemoryRouter>,
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
describe("Space onboarding", () => {
  it("creates a truly empty Blank Space", async () => {
    await name("Family");
    await click("Continue");
    await click("Create Space");
    expect(mocks.create).toHaveBeenCalledWith({
      name: "Family",
      template_id: "blank",
      integration_providers: [],
      app_ids: [],
      app_permissions: {},
    });
  });
  it("reviews the template's editable apps using current permission versions", async () => {
    await name("Family");
    await click("Continue");
    await click("Family");
    expect(document.body.textContent).toContain("App permissions");
    await click("Create Space");
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        template_id: "family",
        app_ids: ["journal"],
        app_permissions: { journal: 3 },
      }),
    );
  });
  it("allows a failed creation to be retried", async () => {
    mocks.create.mockRejectedValueOnce(new Error("Connection interrupted"));
    await name("Family");
    await click("Continue");
    await click("Create Space");
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Connection interrupted");
    await click("Create Space");
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });
});
