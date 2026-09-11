import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/auth", () => ({
  useAuth: () => ({ user: { id: "account-1" } }),
}));

vi.mock("@/features/capability-approvals/api", () => ({
  capabilityApprovalsApi: { list: vi.fn(async () => ({ approvals: [] })) },
}));

vi.mock("@/features/agent-interventions/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/agent-interventions/api")>()),
  agentInterventionsApi: { list: vi.fn(async () => ({ waits: [] })), decide: vi.fn() },
}));

vi.mock("./nativeNotifications", () => ({
  publishNativeActivity: vi.fn(async () => false),
  syncNativeBadge: vi.fn(async () => undefined),
}));

import { agentInterventionsApi } from "@/features/agent-interventions/api";
import { useAgentInterventions } from "@/features/agent-interventions/store";
import { publishNativeActivity } from "./nativeNotifications";
import { useSpacesStore } from "@/features/spaces";
import { ActivityBridge } from "./ActivityBridge";
import { useActivityStore } from "./useActivityStore";

describe("ActivityBridge", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    useActivityStore.persist.clearStorage();
    useActivityStore.setState(useActivityStore.getInitialState(), true);
    useActivityStore.setState({
      accountId: "account-1",
      sourceItems: [],
      localItems: [],
      readAtByKey: {},
      knownSourceIdsByAccount: {},
      baselinedAccounts: [],
      allItems: [],
      attentionItems: [],
      attentionCount: 0,
      loading: false,
      offline: false,
      error: null,
    });
    useSpacesStore.setState({
      inboxError: null,
      inbox: { unreads: [], mentions: [] },
      invitations: [],
      loadInbox: vi.fn(async () => undefined),
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("loads independent requests when the Spaces inbox is unavailable", async () => {
    useSpacesStore.setState({
      loadInbox: vi.fn(async () => {
        useSpacesStore.setState({ inboxError: "Offline" });
      }),
    });
    vi.mocked(agentInterventionsApi.list).mockResolvedValue({
      waits: [
        {
          id: "offline-request",
          runId: "run",
          scopeId: "scope",
          deviceId: "device",
          targetLabel: "Browser",
          action: "sign_in",
          reason: "",
          state: "pending",
          expiresAt: "2099-01-01T00:00:00Z",
        },
      ],
    });
    await act(async () => {
      root.render(
        <MemoryRouter>
          <ActivityBridge />
        </MemoryRouter>,
      );
    });
    expect(
      useActivityStore
        .getState()
        .attentionItems.some((item) => item.sourceId === "offline-request"),
    ).toBe(true);
    vi.mocked(agentInterventionsApi.list).mockResolvedValue({ waits: [] });
  });
  it("adds browser requests to global attention without opening Activity or notifying twice", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/"]}>
          <ActivityBridge />
        </MemoryRouter>,
      );
      await Promise.resolve();
    });
    const item = {
      id: crypto.randomUUID(),
      runId: "invocation_test",
      scopeId: "original-scope",
      deviceId: "device_test",
      targetLabel: "Personal inbox",
      action: "sign_in" as const,
      reason: "Private website text",
      state: "pending" as const,
      expiresAt: "2099-01-01T00:00:00Z",
    };
    vi.mocked(publishNativeActivity).mockClear();
    vi.mocked(agentInterventionsApi.list).mockResolvedValue({ waits: [item] });
    await act(async () => {
      await useAgentInterventions.getState().refresh();
    });
    expect(
      useActivityStore.getState().attentionItems.some((activity) => activity.sourceId === item.id),
    ).toBe(true);
    expect(publishNativeActivity).toHaveBeenCalledTimes(1);
    await act(async () => {
      await useAgentInterventions.getState().refresh();
    });
    expect(publishNativeActivity).toHaveBeenCalledTimes(1);
    vi.mocked(agentInterventionsApi.list).mockResolvedValue({ waits: [] });
    await act(async () => {
      await useAgentInterventions.getState().refresh();
    });
    expect(
      useActivityStore.getState().attentionItems.some((activity) => activity.sourceId === item.id),
    ).toBe(false);
  });

  it("renders no centralized UI and does not read items from broad route visits", async () => {
    useActivityStore.getState().ingestLocal({
      id: "file-error",
      kind: "failure",
      title: "File action needs attention",
      target: { kind: "workspace-tool", tool: "files" },
      notify: false,
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/files"]}>
          <ActivityBridge />
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    expect(container.childElementCount).toBe(0);
    expect(useActivityStore.getState().allItems[0]?.readAt).toBeUndefined();
  });
});
