import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useLocalExecution, type Execution } from "@/features/agents/localExecution";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { subscribeEmbeddedBrowserSuspension } from "@/shared/platform/browserSuspensionSignal";
import { GlobalMisty } from "./GlobalMisty";
import { useGlobalSearchStore } from "./useGlobalSearchStore";
import type * as GlobalMistyApi from "./globalMistyApi";

vi.mock("./globalMistyApi", async (importOriginal) => {
  const original = await importOriginal<typeof GlobalMistyApi>();
  return {
    ...original,
    globalMistyApi: {
      ...original.globalMistyApi,
      conversations: vi.fn().mockResolvedValue({ conversations: [] }),
    },
  };
});

let container: HTMLDivElement;
let root: Root;
let unsubscribe: () => void;
const suspended = new Set<string>();
const execution: Execution = {
  accountId: "account-1",
  agentId: "agent-1",
  spaceId: "",
  taskId: "task-1",
  mode: "agent",
  state: "running",
  normalTabs: true,
  ready: true,
  views: [],
  context: [],
  deviceContexts: [],
};

beforeEach(async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  useMistyStore.getState().setAccount("account-1");
  useMistyStore.setState({
    panel: "closed",
    working: true,
    query: "",
    conversations: [],
    activeConversationId: "",
  });
  useGlobalSearchStore.getState().setAccount("account-1");
  useGlobalSearchStore.getState().closePanel();
  useLocalExecution.setState({ execution });
  suspended.clear();
  unsubscribe = subscribeEmbeddedBrowserSuspension((active, reason) => {
    if (active) suspended.add(reason);
    else suspended.delete(reason);
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <MemoryRouter>
        <GlobalMisty
          accountId="account-1"
          currentPath="/agents"
          activePaneId=""
          activePanePath=""
        />
      </MemoryRouter>,
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  unsubscribe();
  container.remove();
  useLocalExecution.setState({ execution: null });
  vi.restoreAllMocks();
});

it("releases the forced panel and Search on completion without discarding the task", async () => {
  expect(container.querySelector("[data-misty-top-controls]")).not.toBeNull();
  expect(suspended.has("global-misty")).toBe(true);
  const finished = { ...execution, state: "finished" as const };
  await act(async () => {
    useMistyStore.setState({ working: false });
    useLocalExecution.setState({ execution: finished });
  });
  // Native browser visibility must be restored as soon as the task completes.
  expect(suspended.has("global-misty")).toBe(false);
  await vi.waitFor(() => expect(container.querySelector("[data-misty-top-controls]")).toBeNull());
  expect(useLocalExecution.getState().execution).toBe(finished);
  await act(async () => useGlobalSearchStore.getState().openPanel());
  expect(useGlobalSearchStore.getState().panel).toBe("results");
});

it("keeps an explicitly opened conversation available and lets Close dismiss it after completion", async () => {
  await act(async () => {
    useMistyStore.getState().openPanel();
    useMistyStore.setState({ working: false });
    useLocalExecution.setState({ execution: { ...execution, state: "finished" } });
  });
  expect(suspended.has("global-misty")).toBe(true);
  const close = container.querySelector<HTMLButtonElement>('[aria-label="Close Misty"]');
  expect(close).not.toBeNull();
  await act(async () => close?.click());
  expect(suspended.has("global-misty")).toBe(false);
  await vi.waitFor(() => expect(container.querySelector("[data-misty-top-controls]")).toBeNull());
});

it("keeps paused-task recovery controls visible", async () => {
  await act(async () => {
    useMistyStore.setState({ working: false });
    useLocalExecution.setState({ execution: { ...execution, state: "paused" } });
  });
  expect(container.querySelector("[data-misty-top-controls]")).not.toBeNull();
  expect(suspended.has("global-misty")).toBe(true);
  await act(async () => useGlobalSearchStore.getState().openPanel());
  expect(useGlobalSearchStore.getState().panel).toBe("closed");
});

it("keeps the screen unobstructed throughout a desktop task", async () => {
  await act(async () =>
    useLocalExecution.setState({
      execution: { ...execution, normalTabs: false, desktopControl: true },
    }),
  );
  await vi.waitFor(() => expect(container.querySelector("[data-misty-top-controls]")).toBeNull());
  expect(suspended.has("global-misty")).toBe(false);
});
