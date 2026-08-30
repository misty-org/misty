import { ApiRequestError } from "@/api/client";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  flows: vi.fn(),
  callTool: vi.fn(),
}));

vi.mock("./api", () => ({ automationsApi: api }));
vi.mock("./AutomationEditor", () => ({ AutomationEditor: () => <div>Editor</div> }));
vi.mock("./AutomationListings", () => ({
  AutomationListings: (props: { connected: boolean | null; onCreate: () => void }) => (
    <button type="button" data-connected={String(props.connected)} onClick={props.onCreate}>
      Create
    </button>
  ),
}));

import { AutomationsWorkspace } from "./AutomationsWorkspace";

describe("AutomationsWorkspace creation guard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    api.flows.mockReset();
    api.callTool.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps users in Misty when the managed automation engine is unavailable", async () => {
    api.flows.mockResolvedValue({ connected: false, structured_content: [] });
    await renderWorkspace();

    const create = container.querySelector<HTMLButtonElement>('button[data-connected="false"]');
    expect(create).not.toBeNull();
    await act(async () => create?.click());

    expect(api.callTool).not.toHaveBeenCalled();
  });

  it("allows only one in-flight create request", async () => {
    api.flows.mockResolvedValue({ connected: true, structured_content: [] });
    let finishCreate!: (value: unknown) => void;
    api.callTool.mockImplementation(() => new Promise((resolve) => (finishCreate = resolve)));
    const onSelectedFlowChange = vi.fn();
    await renderWorkspace(onSelectedFlowChange);

    const create = container.querySelector<HTMLButtonElement>('button[data-connected="true"]');
    await act(async () => {
      create?.click();
      create?.click();
    });

    expect(api.callTool).toHaveBeenCalledOnce();
    finishCreate({
      structured_content: { flowId: "flow-1", displayName: "Untitled automation" },
    });
    await act(async () => Promise.resolve());
    expect(onSelectedFlowChange).toHaveBeenCalledWith("flow-1");
  });

  it("turns a disconnected conflict into an in-app managed-service state", async () => {
    api.flows.mockResolvedValue({ connected: true, structured_content: [] });
    api.callTool.mockRejectedValue(
      new ApiRequestError(
        "Connect Activepieces before creating automations.",
        409,
        "activepieces_not_connected",
      ),
    );
    await renderWorkspace();

    const create = container.querySelector<HTMLButtonElement>('button[data-connected="true"]');
    await act(async () => {
      create?.click();
      await Promise.resolve();
    });

    expect(api.callTool).toHaveBeenCalledOnce();
    expect(container.querySelector('button[data-connected="false"]')).not.toBeNull();
  });

  async function renderWorkspace(onSelectedFlowChange = vi.fn()) {
    await act(async () => {
      root.render(
        <AutomationsWorkspace
          onSelectedFlowChange={onSelectedFlowChange}
          onCreateWithMisty={vi.fn()}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
  }
});
