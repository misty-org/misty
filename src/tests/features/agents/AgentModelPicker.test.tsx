import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentModelPicker } from "@/features/agents/components/AgentModelPicker";
import { initialAgentModelId, initialAgentModelName } from "@/features/agents/modelSelection";
import type { GatewayModel } from "@/models/interfaces/features/agents/personal";
import { Dialog, DialogContent, DialogTitle } from "@/ui";

describe("AgentModelPicker", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document
      .querySelectorAll("[data-radix-popper-content-wrapper]")
      .forEach((node) => node.remove());
    delete (HTMLElement.prototype as unknown as { scrollIntoView?: () => void }).scrollIntoView;
    container.remove();
  });

  it("opens a searchable catalog without truncating the available models", async () => {
    const models: GatewayModel[] = [
      {
        id: initialAgentModelId,
        name: initialAgentModelName,
        capabilities: ["language"],
      },
      ...Array.from({ length: 204 }, (_, index) => ({
        id: `provider-${index}/model-${index}`,
        name: `Model ${index}`,
        capabilities: ["language"],
      })),
    ];
    const onValueChange = vi.fn();

    await act(async () => {
      root.render(
        <AgentModelPicker
          models={models}
          value={initialAgentModelId}
          onValueChange={onValueChange}
        />,
      );
    });
    const trigger = container.querySelector<HTMLButtonElement>(
      `[aria-label="Model: ${initialAgentModelName}"]`,
    );
    expect(trigger).not.toBeNull();

    await act(async () => {
      trigger?.click();
      await Promise.resolve();
    });

    expect(
      document.querySelector('input[placeholder="Search 205 Vercel AI models…"]'),
    ).not.toBeNull();
    expect(document.body.textContent).toContain("Vercel AI Gateway · 205 models");
    expect(document.body.textContent).toContain(initialAgentModelName);
    expect(document.body.textContent).not.toContain("Default");
    expect(document.body.textContent).not.toContain("Automatic");
    expect(document.body.textContent).not.toContain("Routing");
    expect(document.body.textContent).toContain("Model 203");
  });

  it("requires a concrete model instead of offering an abstract selection", async () => {
    await act(async () => {
      root.render(<AgentModelPicker models={[]} value="" onValueChange={vi.fn()} />);
    });
    expect(container.textContent).toContain("Choose a model");
    expect(container.textContent).not.toContain("Default");
    expect(container.textContent).not.toContain("Automatic");
  });

  it("allows its portaled model list to scroll from inside a modal dialog", async () => {
    const models: GatewayModel[] = Array.from({ length: 72 }, (_, index) => ({
      id: `provider/model-${index}`,
      name: `Model ${index}`,
      capabilities: ["language"],
    }));

    await act(async () => {
      root.render(
        <Dialog defaultOpen>
          <DialogContent>
            <DialogTitle>Configure Agent</DialogTitle>
            <AgentModelPicker models={models} value={models[0].id} onValueChange={vi.fn()} />
          </DialogContent>
        </Dialog>,
      );
    });

    const trigger = document.querySelector<HTMLButtonElement>('[aria-label="Model: Model 0"]');
    await act(async () => {
      trigger?.click();
      await Promise.resolve();
    });

    const list = document.querySelector<HTMLElement>("[cmdk-list]");
    expect(list).not.toBeNull();
    if (!list) return;

    list.style.overflowY = "auto";
    Object.defineProperties(list, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, value: 0, writable: true },
    });
    const wheel = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 100,
    });
    list.dispatchEvent(wheel);

    expect(wheel.defaultPrevented).toBe(false);
  });
});
