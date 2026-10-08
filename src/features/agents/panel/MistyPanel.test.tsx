import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProfile } from "@/shared/schemas";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { useSettingsStore } from "@/features/settings";
import { usePersonalAgentsStore } from "../personalAgentsStore";
import { MistyPanel } from "./MistyPanel";
import { useMistyPanelStore } from "./mistyPanelStore";

vi.mock("@/features/auth", () => ({
  useAuth: vi.fn(() => ({ user: { id: "test-user-id" } })),
}));

vi.mock("@/api/accountEvents", () => ({
  observeAccountChanges: vi.fn((_id, _topics, callback) => {
    void callback();
    return () => {};
  }),
}));

vi.mock("@/features/ai-surface/useAiVoiceRecorder", () => ({
  useAiVoiceRecorder: () => ({
    recording: false,
    requesting: false,
    transcribing: false,
    start: vi.fn(),
    stop: vi.fn(),
  }),
}));

vi.mock("@/features/misty/handoff", () => ({
  showMistyConversation: vi.fn(),
}));

const mockAgent = {
  id: "agent-1",
  name: "Misty Assistant",
  role: "General helper",
  enabled: true,
  system_managed: true,
  avatar: {},
  model_mode: "automatic",
} as unknown as AgentProfile;

describe("MistyPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMistyPanelStore.setState({ open: true });
    usePersonalAgentsStore.setState({
      accountId: "test-user-id",
      agents: [mockAgent],
      selected: {},
      loading: false,
      error: "",
    });
    useMistyStore.getState().setAccount("test-user-id");
    useMistyStore.setState({
      conversations: [],
      activeConversationId: "",
      working: false,
      selectedAgentId: "agent-1",
    });
    useSettingsStore.setState({
      settings: {
        path: "test",
        document: {
          agent: {
            panel_side: "right",
          },
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders with proper layout container classes and controls", () => {
    const { container } = render(
      <MemoryRouter>
        <MistyPanel side="right" />
      </MemoryRouter>,
    );

    const aside = container.querySelector("aside[data-misty-panel='right']");
    expect(aside).toBeTruthy();
    expect(aside?.classList.contains("agents-workspace")).toBe(true);
    expect(aside?.classList.contains("shrink-0")).toBe(true);

    const studioTask = container.querySelector(".agent-studio-task");
    expect(studioTask).toBeTruthy();
    expect(studioTask?.classList.contains("h-full")).toBe(true);

    const chat = container.querySelector(".agents-chat");
    expect(chat).toBeTruthy();

    expect(screen.getByRole("button", { name: /Close Misty/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Open in Agents/i })).toBeDefined();
    expect(screen.getByPlaceholderText(/Message Misty Assistant/i)).toBeDefined();
  });

  it("renders on the left side when requested", () => {
    const { container } = render(
      <MemoryRouter>
        <MistyPanel side="left" />
      </MemoryRouter>,
    );
    const aside = container.querySelector("aside[data-misty-panel='left']");
    expect(aside).toBeTruthy();
  });

  it("closes on Escape key press", () => {
    const { container } = render(
      <MemoryRouter>
        <MistyPanel side="right" />
      </MemoryRouter>,
    );

    const aside = container.querySelector("aside")!;
    fireEvent.keyDown(aside, { key: "Escape" });
    expect(useMistyPanelStore.getState().open).toBe(false);
  });

  it("closes when the close button is clicked", () => {
    render(
      <MemoryRouter>
        <MistyPanel side="right" />
      </MemoryRouter>,
    );

    const closeBtn = screen.getByRole("button", { name: /Close Misty/i });
    fireEvent.click(closeBtn);
    expect(useMistyPanelStore.getState().open).toBe(false);
  });

  it("reads side from settings store when props omitted", () => {
    useSettingsStore.setState({
      settings: {
        path: "test",
        document: {
          agent: {
            panel_side: "left",
          },
        },
      },
    });
    const { container } = render(
      <MemoryRouter>
        <MistyPanel />
      </MemoryRouter>,
    );
    const aside = container.querySelector<HTMLElement>("aside[data-misty-panel='left']")!;
    expect(aside).toBeTruthy();
  });
});
