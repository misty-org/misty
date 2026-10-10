import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSpaceSearchStore } from "@/features/workspace/spaceSearch";
import { BrowserBangsSettings } from "./BrowserBangsSettings";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));

const jira = { trigger: "jira", name: "Jira", url: "https://jira.example/search?q=%s" };
const wiki = { trigger: "wiki", name: "Team wiki", url: "https://wiki.example/?q=%s" };
const device = { general: { browser_custom_bangs_json: JSON.stringify([wiki]) } };

describe("search shortcut settings", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    invoke.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useSpaceSearchStore.setState({ space: null, deviceBangsRaw: "[]" });
  });

  it("lists and edits the window's Space's shortcuts, not the device's", async () => {
    useSpaceSearchStore.setState({
      space: { spaceId: "space-a", engine: "google", engines: [], bangs: [jira] },
    });
    const onSettingChange = vi.fn();
    invoke.mockResolvedValueOnce({ spaceId: "space-a", engine: "google", engines: [], bangs: [] });
    await act(async () =>
      root.render(
        <BrowserBangsSettings
          document={device}
          working={false}
          onSettingChange={onSettingChange}
        />,
      ),
    );
    expect(container.textContent).toContain("!jira");
    expect(container.textContent).not.toContain("!wiki");
    expect(container.textContent).toContain("this window's Space");
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Remove !jira"]')!.click(),
    );
    expect(invoke).toHaveBeenCalledWith("browser_space_search", { bangs: [] });
    expect(onSettingChange).not.toHaveBeenCalled();
    expect(container.textContent).toContain("No shortcuts of your own yet.");
  });

  it("keeps the device's shortcuts in its settings while sync is off", async () => {
    const onSettingChange = vi.fn();
    await act(async () =>
      root.render(
        <BrowserBangsSettings
          document={device}
          working={false}
          onSettingChange={onSettingChange}
        />,
      ),
    );
    expect(container.textContent).toContain("!wiki");
    expect(container.textContent).toContain("stay on this device while sync is off");
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Remove !wiki"]')!.click(),
    );
    expect(onSettingChange).toHaveBeenCalledWith("general", "browser_custom_bangs_json", "[]");
    expect(invoke).not.toHaveBeenCalled();
  });
});
