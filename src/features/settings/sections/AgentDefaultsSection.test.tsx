import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "../store/useSettingsStore";
import { useSettingsProfiles } from "../profiles/store";
import { registerProfileWriter } from "../profiles/bridge";
import { AgentDefaultsSection } from "./FeatureSections";

describe("AgentDefaultsSection Misty panel controls", () => {
  const updateSettingSpy = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsProfiles.setState({ ready: true });
    useSettingsStore.setState({
      working: false,
      settings: {
        path: "test",
        document: {
          agent: {
            panel_side: "right",
          },
        },
      },
    });
    registerProfileWriter(async (id, value) => {
      updateSettingSpy(id, value);
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the Misty panel side control", () => {
    render(<AgentDefaultsSection />);

    expect(screen.getByText("Misty panel")).toBeTruthy();
    expect(screen.getByText("Misty panel side")).toBeTruthy();

    const leftRadio = screen.getByRole("radio", { name: "Left" });
    const rightRadio = screen.getByRole("radio", { name: "Right" });
    expect(leftRadio).toBeTruthy();
    expect(rightRadio).toBeTruthy();
  });

  it("switches Misty panel side to left when Left is clicked", () => {
    render(<AgentDefaultsSection />);

    const leftRadio = screen.getByRole("radio", { name: "Left" });
    fireEvent.click(leftRadio);

    expect(updateSettingSpy).toHaveBeenCalledWith("agents.panel_side", "left");
  });

  it("chooses the web search engine", () => {
    render(<AgentDefaultsSection />);

    expect(screen.getByText("Web search")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Perplexity" }));
    expect(updateSettingSpy).toHaveBeenCalledWith("agents.web_search_engine", "perplexity");
  });
});
