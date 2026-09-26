import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "@/features/settings";
import { useSpaceAgendaPreferences } from "./useSpaceAgendaPreferences";
import {
  useSpacesTabsStore,
  spacesTabsSessionKey,
  type SpaceWorkspaceTab,
} from "./useSpacesTabsStore";

function preferences(spaces: Record<string, unknown>) {
  useSettingsStore.setState({ settings: { path: "", document: { spaces } } });
}
describe("Space preference precedence", () => {
  beforeEach(() => {
    localStorage.clear();
    preferences({});
    useSpacesTabsStore.setState({ sessions: {} });
  });
  it("uses Home by default, then the profile's opening tool for new sessions only", () => {
    const store = useSpacesTabsStore.getState();
    store.ensureSession("account", "first");
    const route = (id: string) =>
      (
        useSpacesTabsStore.getState().sessions[spacesTabsSessionKey("account", id)]
          .tabs[0] as SpaceWorkspaceTab
      ).route;
    expect(route("first")).toBe("/spaces/first/home");
    preferences({ opening_tool: "chat" });
    store.ensureSession("account", "second");
    expect(route("second")).toBe("/spaces/second/chat");
    store.ensureSession("account", "first");
    expect(route("first")).toBe("/spaces/first/home");
    store.ensureSession("account", "explicit", "/spaces/explicit/library");
    expect(route("explicit")).toBe("/spaces/explicit/library");
  });
  it("applies Agenda defaults live while retaining explicit per-Space choices", () => {
    preferences({ agenda_tasks: false, agenda_roadmap: true });
    const a = renderHook(() => useSpaceAgendaPreferences("account", "a"));
    const b = renderHook(() => useSpaceAgendaPreferences("account", "b"));
    expect(a.result.current.visibility).toMatchObject({ tasks: false, roadmap: true });
    act(() =>
      a.result.current.setVisibility({ tasks: false, roadmap: true, hiddenSources: ["private"] }),
    );
    act(() => preferences({ agenda_tasks: true, agenda_roadmap: false }));
    expect(a.result.current.visibility).toEqual({
      tasks: false,
      roadmap: true,
      hiddenSources: ["private"],
    });
    expect(b.result.current.visibility).toEqual({ tasks: true, roadmap: false, hiddenSources: [] });
  });
});
