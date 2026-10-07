import { beforeEach, expect, it, vi } from "vitest";
import type { ScreenRequest } from "@/features/ai-surface/types";
import type { GlobalSearchState } from "@/features/global-search/globalSearchState";
const mocks = vi.hoisted(() => ({
  capture: vi.fn(async () => ({ capture: { id: "shot" }, label: "Window" })),
  desktop: true,
  companion: {
    accountId: "",
    submit: undefined as undefined | ((request: unknown) => Promise<void>),
  },
}));
vi.mock("./screenContext", () => ({ captureMistyScreen: mocks.capture }));
vi.mock("@/features/agents/workspaceAutopilot", () => ({
  visibleAutopilotAvailable: () => mocks.desktop,
}));
vi.mock("@/features/agents/companion/companionState", () => ({
  useCompanionState: { getState: () => mocks.companion },
}));
import {
  continueAfterScreenRequest,
  declineScreenRequest,
  openScreenAndContinue,
} from "./screenRequests";

let state: GlobalSearchState;
const get = () => state;
const set = (
  patch: Partial<GlobalSearchState> | ((s: GlobalSearchState) => Partial<GlobalSearchState>),
) => {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
};
const submitAnswer = vi.fn(async (..._args: unknown[]) => {});
function withRequest(request: ScreenRequest) {
  state = {
    accountId: "owner",
    panel: "closed",
    working: false,
    error: null,
    closePanel: vi.fn(),
    submitAnswer,
    conversations: [
      {
        id: "chat",
        title: "Chat",
        createdAt: "",
        updatedAt: "",
        messages: [
          {
            id: "reply",
            role: "assistant",
            mode: "ask",
            content: "",
            createdAt: "",
            screenRequest: request,
          },
        ],
      },
    ],
  } as unknown as GlobalSearchState;
}
const current = () => state.conversations[0].messages[0].screenRequest;
beforeEach(() => {
  submitAnswer.mockClear();
  mocks.capture.mockClear();
  mocks.companion = { accountId: "", submit: undefined };
});

it("continues in a separate window by default, without a new user turn", async () => {
  withRequest({
    kind: "open",
    reason: "Read the site",
    location: "separate",
    url: "https://example.com",
    state: "pending",
  });
  continueAfterScreenRequest(set, get, "chat", "reply");
  await vi.waitFor(() => expect(current()?.state).toBe("opened"));
  expect(submitAnswer).toHaveBeenCalledWith(
    expect.stringContaining("separate Misty window"),
    [],
    undefined,
    "workspace",
    [],
    { conversationId: "chat", context: [] },
    expect.objectContaining({ executionMode: "team", continuation: true, openScreen: undefined }),
  );
  expect(submitAnswer.mock.calls[0][0]).toContain("Start at https://example.com.");
});

it("opens a tab in this window at the requested page", async () => {
  withRequest({
    kind: "open",
    reason: "Read the site",
    location: "window",
    url: "https://example.com",
    state: "pending",
  });
  continueAfterScreenRequest(set, get, "chat", "reply");
  await vi.waitFor(() => expect(submitAnswer).toHaveBeenCalled());
  expect(submitAnswer.mock.calls[0][6]).toMatchObject({
    executionMode: "agent",
    openScreen: { url: "https://example.com" },
  });
});

it("starts desktop control with Misty's own cursor, whatever the screen location", async () => {
  withRequest({
    kind: "desktop",
    reason: "Add a row in Numbers",
    location: "ask",
    state: "pending",
  });
  continueAfterScreenRequest(set, get, "chat", "reply");
  await vi.waitFor(() => expect(current()?.state).toBe("opened"));
  expect(submitAnswer.mock.calls[0][0]).toContain("desktop apps with its own cursor");
  expect(submitAnswer.mock.calls[0][6]).toMatchObject({
    executionMode: "agent",
    continuation: true,
    openScreen: undefined,
  });
  mocks.desktop = false;
  withRequest({
    kind: "desktop",
    reason: "Add a row in Numbers",
    location: "separate",
    state: "pending",
  });
  continueAfterScreenRequest(set, get, "chat", "reply");
  await vi.waitFor(() => expect(current()?.state).toBe("failed"));
  expect(current()?.error).toContain("needs the Misty app on a Mac");
  mocks.desktop = true;
});

it("waits for the user's choice when the account asks each time", async () => {
  withRequest({ kind: "open", reason: "Read the site", location: "ask", state: "pending" });
  continueAfterScreenRequest(set, get, "chat", "reply");
  expect(submitAnswer).not.toHaveBeenCalled();
  expect(current()?.state).toBe("pending");
  await openScreenAndContinue(set, get, "chat", "reply", "window");
  expect(submitAnswer.mock.calls[0][6]).toMatchObject({ executionMode: "agent" });
  withRequest({ kind: "open", reason: "Read the site", location: "ask", state: "pending" });
  declineScreenRequest(set, get, "chat", "reply");
  expect(current()?.state).toBe("declined");
});

it("looks through the companion when it runs, so the answer can point at the screen", async () => {
  const submit = vi.fn(async () => {});
  mocks.companion = { accountId: "owner", submit };
  withRequest({ kind: "look", reason: "See the error", location: "ask", state: "pending" });
  continueAfterScreenRequest(set, get, "chat", "reply");
  await vi.waitFor(() => expect(current()?.state).toBe("opened"));
  expect(submit).toHaveBeenCalledWith(
    expect.objectContaining({ conversationId: "chat", look: true, continuation: true }),
  );
  expect(submitAnswer).not.toHaveBeenCalled();
});

it("attaches a window capture when the companion is not running", async () => {
  withRequest({ kind: "look", reason: "See the error", location: "separate", state: "pending" });
  continueAfterScreenRequest(set, get, "chat", "reply");
  await vi.waitFor(() => expect(current()?.state).toBe("opened"));
  expect(mocks.capture).toHaveBeenCalledOnce();
  expect(submitAnswer.mock.calls[0][6]).toMatchObject({
    executionMode: "user",
    capture: { id: "shot" },
  });
});

it("reports a failure on the card instead of starting work while another task runs", async () => {
  withRequest({ kind: "open", reason: "Read the site", location: "separate", state: "pending" });
  state = { ...state, working: true };
  await openScreenAndContinue(set, get, "chat", "reply", "separate");
  expect(current()).toMatchObject({
    state: "failed",
    error: expect.stringContaining("Another task"),
  });
  expect(submitAnswer).not.toHaveBeenCalled();
});
