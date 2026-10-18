import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { activeLayoutView, parseBrowserViewState, useWorkspaceStore } from "@/features/workspace";
import { BrowserSearchDialog } from "./BrowserSearchDialog";
import { useBrowserSearchStore } from "./search";
import { usePersonalAgentsStore } from "@/features/agents/personalAgentsStore";
import { useMistyStore } from "@/features/misty/useMistyStore";
import type { AgentProfile } from "@/shared/schemas";
vi.mock("@/features/webviews/browserRuntime", () => ({
  onBrowserRuntimeClose: () => () => undefined,
  setBrowserWebviewsSuspended: vi.fn(),
}));
beforeEach(() => {
  useWorkspaceStore.getState().reset();
  useBrowserSearchStore.getState().show();
});
afterEach(() => {
  cleanup();
  useBrowserSearchStore.getState().close();
});

function renderDialog() {
  render(
    <MemoryRouter>
      <BrowserSearchDialog />
    </MemoryRouter>,
  );
  return screen.getByRole("textbox", { name: "Search or enter a URL" });
}

function openedUrl() {
  const tab = activeLayoutView(useWorkspaceStore.getState().layout)!;
  expect(tab.surfaceId).toBe("browser");
  expect(tab.route).toBe("/browser");
  return parseBrowserViewState(tab.state).url;
}

describe("browser search submission", () => {
  it("opens a search with Google as a native browser tab and closes the box", async () => {
    fireEvent.change(renderDialog(), { target: { value: "workspace sync" } });
    fireEvent.click(screen.getByRole("button", { name: "Open in new tab" }));
    await waitFor(() => expect(useBrowserSearchStore.getState().open).toBe(false));
    expect(openedUrl()).toBe("https://www.google.com/search?q=workspace%20sync");
  });

  it("does not create a tab for a blank submission", () => {
    renderDialog();
    const before = useWorkspaceStore.getState().layout;
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);
    expect(useWorkspaceStore.getState().layout).toBe(before);
    expect(useBrowserSearchStore.getState().open).toBe(true);
  });
});

describe("internal Misty items excluded", () => {
  const agent = (id: string, name: string, system = false) =>
    ({
      id,
      name,
      role: "",
      enabled: true,
      system_managed: system,
      avatar: {},
    }) as unknown as AgentProfile;
  beforeEach(() => {
    usePersonalAgentsStore.setState({
      agents: [agent("misty", "Misty", true), agent("res", "Researcher")],
    });
    useMistyStore.setState({ selectedAgentId: "" });
  });

  const optionNames = () => screen.getAllByRole("option").map((option) => option.textContent ?? "");

  it("never offers asking an agent for requests or questions", () => {
    fireEvent.change(renderDialog(), { target: { value: "summarize this page for me" } });
    expect(optionNames().some((name) => name.includes("Misty"))).toBe(false);
    expect(optionNames()[0]).toBe("summarize this page for me");
  });

  it("never offers asking an agent for search queries", () => {
    fireEvent.change(renderDialog(), { target: { value: "pizza brooklyn" } });
    const names = optionNames();
    expect(names.some((name) => name.includes("Misty"))).toBe(false);
    expect(names[0]).toBe("pizza brooklyn");
  });

  it("does not offer asking for an address", () => {
    fireEvent.change(renderDialog(), { target: { value: "github.com" } });
    expect(optionNames().some((name) => name.includes("Misty"))).toBe(false);
  });

  it("does not treat @ as an agent mention", () => {
    fireEvent.change(renderDialog(), { target: { value: "@res find the launch date" } });
    const names = optionNames();
    expect(names.some((name) => name.includes("Researcher"))).toBe(false);
    expect(names[0]).toBe("@res find the launch date");
  });
});
