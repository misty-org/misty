import { beforeEach, expect, it, vi } from "vitest";
import type { AppRequest } from "@/features/agents";
import type { GlobalSearchState } from "@/features/global-search/globalSearchState";
import { continueAfterAppRequest } from "./appRequests";

let state: GlobalSearchState;
const get = () => state;
const set = (
  patch: Partial<GlobalSearchState> | ((s: GlobalSearchState) => Partial<GlobalSearchState>),
) => {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
};
const submitAnswer = vi.fn(async (..._args: unknown[]) => {});
const card = (patch: Partial<AppRequest> = {}): AppRequest => ({
  id: `apprq-${Math.random()}`,
  kind: "connect",
  subject: "gmail",
  title: "Connect Gmail",
  summary: "",
  state: "pending",
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  ...patch,
});
function withCard(request: AppRequest, extra: object[] = []) {
  state = {
    panel: "closed",
    working: false,
    error: null,
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
            appRequest: request,
          },
          ...extra,
        ],
      },
    ],
  } as unknown as GlobalSearchState;
}
beforeEach(() => submitAnswer.mockClear());

it("continues the conversation once, after the app is connected", async () => {
  const pending = card();
  withCard(pending);
  const connected = { ...pending, state: "connected" as const };
  await continueAfterAppRequest(set, get, "chat", "reply", connected);
  await continueAfterAppRequest(set, get, "chat", "reply", connected);
  expect(submitAnswer).toHaveBeenCalledTimes(1);
  expect(submitAnswer.mock.calls[0][0]).toBe("Continue the request above. Gmail is now connected.");
  expect(submitAnswer.mock.calls[0][6]).toMatchObject({ continuation: true });
  expect(state.conversations[0].messages[0].appRequest?.state).toBe("connected");
});

it("continues after an approval but not after a decline", async () => {
  const approval = card({ kind: "approve", title: "Send email to Ana" });
  withCard(approval);
  await continueAfterAppRequest(set, get, "chat", "reply", { ...approval, state: "declined" });
  expect(submitAnswer).not.toHaveBeenCalled();
  await continueAfterAppRequest(set, get, "chat", "reply", { ...approval, state: "approved" });
  expect(submitAnswer.mock.calls[0][0]).toBe(
    "Continue the request above. The user approved “Send email to Ana”.",
  );
});

it("leaves a still-running task, or a conversation that moved on, to itself", async () => {
  const pending = card();
  withCard(pending);
  state = { ...state, working: true };
  await continueAfterAppRequest(set, get, "chat", "reply", { ...pending, state: "connected" });
  const later = card();
  withCard(later, [
    { id: "next", role: "user", mode: "ask", content: "something else", createdAt: "" },
  ]);
  await continueAfterAppRequest(set, get, "chat", "reply", { ...later, state: "connected" });
  expect(submitAnswer).not.toHaveBeenCalled();
});
