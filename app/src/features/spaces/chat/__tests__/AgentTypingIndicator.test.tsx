import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentTypingIndicator } from "../components/AgentTypingIndicator";

describe("AgentTypingIndicator", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("announces the Agent turn with three animated dots", async () => {
    await act(async () => root.render(<AgentTypingIndicator />));

    expect(container.querySelector('[aria-label="Agent is responding"]')).not.toBeNull();
    // Staggered delays are what make it read as typing rather than blinking.
    const dots = container.querySelectorAll(".motion-safe\\:animate-bounce");
    expect(dots.length).toBe(3);
    expect(container.querySelector('[class*="animation-delay:-300ms"]')).not.toBeNull();
    expect(container.querySelector('[class*="animation-delay:-150ms"]')).not.toBeNull();
  });

  it("only offers Cancel once the run exists to cancel", async () => {
    await act(async () => root.render(<AgentTypingIndicator />));
    expect(container.querySelector("button")).toBeNull();

    await act(async () => root.render(<AgentTypingIndicator runId="run-1" />));
    expect(container.querySelector("button")?.textContent).toContain("Cancel");
  });
});
