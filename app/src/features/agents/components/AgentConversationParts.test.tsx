import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpaceMessage } from "@/api/spaces/dto/interfaces/types";
import type { PersonalAgent, PersonalAgentRunSummary } from "../model/interfaces/personal";
import { ConversationMessage, friendlyRunError } from "./AgentConversationParts";

vi.mock("../AgentAvatar", () => ({ AgentAvatar: () => <span aria-label="Agent avatar" /> }));

describe("Agent conversation messages", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows a plain conversational failure with recovery controls and no runtime metadata", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onRetry = vi.fn();
    const onDetails = vi.fn();
    const message = {
      id: "message_response",
      sender_kind: "agent",
      content: [
        { type: "text", text: "I couldn't create the task because the due date was unclear." },
      ],
    } as SpaceMessage;
    const run = {
      run_id: "run_secret_identifier",
      state: "completed_with_errors",
      input_modality: "text",
    } as PersonalAgentRunSummary;
    const agent = { id: "agent_1", name: "Buzz", avatar: {}, icon: "" } as PersonalAgent;

    await act(async () => {
      root.render(
        <ConversationMessage
          message={message}
          agent={agent}
          run={run}
          playing={false}
          hasAudio={false}
          onAudio={() => undefined}
          onRetry={onRetry}
          onDetails={onDetails}
        />,
      );
    });

    expect(container.textContent).toContain("due date could not be understood");
    expect(container.textContent).toContain("Retry");
    expect(container.textContent).toContain("Details");
    expect(container.textContent).not.toContain("run_secret_identifier");
    expect(container.textContent).not.toContain("model:");

    const buttons = [...container.querySelectorAll("button")];
    await act(async () => buttons.find((button) => button.textContent?.includes("Retry"))?.click());
    await act(async () =>
      buttons.find((button) => button.textContent?.includes("Details"))?.click(),
    );
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onDetails).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });

  it("acknowledges a retry immediately and prevents duplicate clicks", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onRetry = vi.fn();

    await act(async () => {
      root.render(
        <ConversationMessage
          message={
            {
              id: "message-response",
              sender_kind: "agent",
              content: [{ type: "text", text: "That did not work." }],
            } as SpaceMessage
          }
          agent={{ id: "agent-1", name: "Buzz", avatar: {}, icon: "" } as PersonalAgent}
          run={
            {
              run_id: "run-failed",
              state: "failed",
              input_modality: "text",
            } as PersonalAgentRunSummary
          }
          playing={false}
          hasAudio={false}
          onAudio={() => undefined}
          onRetry={onRetry}
          retrying
          onDetails={() => undefined}
        />,
      );
    });

    const retry = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Retrying"),
    );
    expect(retry?.textContent).toContain("Retrying…");
    expect(retry?.disabled).toBe(true);
    await act(async () => retry?.click());
    expect(onRetry).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("shows local delivery state while the server request is pending", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ConversationMessage
          message={
            {
              id: "optimistic-message",
              sender_kind: "person",
              local_delivery_state: "sending",
              content: [{ type: "text", text: "Start this now" }],
            } as SpaceMessage
          }
          agent={{ id: "agent-1", name: "Buzz", avatar: {}, icon: "" } as PersonalAgent}
          playing={false}
          hasAudio={false}
          onAudio={() => undefined}
          onDetails={() => undefined}
        />,
      );
    });

    expect(container.textContent).toContain("Start this now");
    expect(container.textContent).toContain("Sending…");
    await act(async () => root.unmount());
  });

  it("never exposes Workflow fatal error objects in the customer-facing copy", () => {
    const visible = friendlyRunError(
      `I couldn't fully complete that request. tasks create: {"fatal":true,"name":"FatalError"}`,
    );
    expect(visible).toContain("temporary problem");
    expect(visible).not.toContain("FatalError");
    expect(visible).not.toContain("fatal");
  });
});
