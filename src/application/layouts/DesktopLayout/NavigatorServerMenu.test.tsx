import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NavigatorServerMenu } from "./NavigatorServerMenu";

const mocks = vi.hoisted(() => ({
  environment: {
    serverMode: "hosted",
    serverUrl: null as string | null,
    serverName: null as string | null,
  },
  apply: vi.fn(),
  settings: vi.fn(),
  native: true,
}));
vi.mock("@/features/app-shell", () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({ app: { environment: mocks.environment } }),
}));
vi.mock("@/features/deployment", () => ({
  applyDeployment: mocks.apply,
  readKnownDeployments: () => [{ url: "https://studio.example", name: "Studio" }],
  deploymentHostLabel: (url: string) => new URL(url).host,
}));
vi.mock("@/features/settings", () => ({
  useSettingsStore: { getState: () => ({ setActiveSection: mocks.settings }) },
}));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => mocks.native }));
let container: HTMLDivElement;
let root: Root;
const openSettings = vi.fn();
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.environment = { serverMode: "hosted", serverUrl: null, serverName: null };
  mocks.native = true;
  vi.clearAllMocks();
  mocks.apply.mockReset().mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function openMenu() {
  await act(async () => root.render(<NavigatorServerMenu onSettingsClick={openSettings} />));
  await act(async () =>
    container
      .querySelector("button")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
  );
}
function item(label: string) {
  return [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find(
    (el) => el.textContent === label,
  )!;
}
it("marks the active server and switches to a saved server", async () => {
  await openMenu();
  expect(item("Misty Hosted").getAttribute("aria-checked")).toBe("true");
  await act(async () => item("Studio").click());
  expect(mocks.apply).toHaveBeenCalledWith({ mode: "self_hosted", url: "https://studio.example" });
  expect(document.body.textContent).toContain("Connecting… Misty will restart.");
});
it("includes an unremembered current server and can return to Hosted", async () => {
  mocks.environment = {
    serverMode: "self_hosted",
    serverUrl: "https://work.example",
    serverName: "Work",
  };
  await openMenu();
  expect(item("Work").getAttribute("aria-checked")).toBe("true");
  await act(async () => item("Misty Hosted").click());
  expect(mocks.apply).toHaveBeenCalledWith({ mode: "hosted" });
});
it("keeps the current selection and permits retry after a failed switch", async () => {
  mocks.apply.mockRejectedValueOnce(new Error("Server unavailable"));
  await openMenu();
  await act(async () => item("Studio").click());
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Server unavailable");
  expect(item("Misty Hosted").getAttribute("aria-checked")).toBe("true");
  await act(async () => item("Studio").click());
  expect(mocks.apply).toHaveBeenCalledTimes(2);
});
it("opens Connection settings to connect another server", async () => {
  await openMenu();
  await act(async () => item("Connect another server…").click());
  expect(mocks.settings).toHaveBeenCalledWith("server");
  expect(openSettings).toHaveBeenCalledOnce();
});
