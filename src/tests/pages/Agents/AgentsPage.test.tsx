import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AgentsPage from "@/pages/Agents";

describe("AgentsPage beta gate", () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    fetchMock = vi.fn(() => Promise.resolve(new Response("{}")));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders only the coming soon copy", async () => {
    await act(async () => root.render(<AgentsPage />));

    expect(container.textContent).toBe("Agents are coming soon...");
  });

  it("issues no agent or model backend request", async () => {
    await act(async () => root.render(<AgentsPage />));
    // Flush any effect-scheduled work a store initializer would have queued.
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders no interactive agent configuration surface", async () => {
    await act(async () => root.render(<AgentsPage />));

    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.querySelectorAll("input, textarea, select")).toHaveLength(0);
  });
});
