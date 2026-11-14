import { describe, expect, it, vi } from "vitest";
import type { TutorJob } from "./tutorTypes";
import {
  elsewhere,
  fakes,
  flush,
  follow,
  jobOf,
  setChats,
  type Chat,
} from "./tutorRuns.testFixtures";

// What Tutor does with its runs when Misty opens again after closing under them.
describe("runs Misty closed under", () => {
  const saved = (change: Partial<TutorJob>): TutorJob => ({
    id: "job-old",
    kind: "deck",
    title: "Flashcards: Volcanoes",
    agentId: "agent-1",
    conversationId: elsewhere.id,
    prompt: "Make it",
    notebookId: "n1",
    state: "failed",
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    ...change,
  });

  it("starts an interrupted run again once", async () => {
    fakes.stored.tutor_job = [saved({ error: "Misty closed before this run finished." })];
    await follow();
    await vi.waitFor(() => expect(jobOf("job-old").state).toBe("running"));
    expect(jobOf("job-old").restarts).toBe(1);
  });

  it("leaves an interrupted run alone once it has been started again", async () => {
    fakes.stored.tutor_job = [
      saved({ error: "Misty closed before this run finished.", restarts: 1 }),
    ];
    await follow();
    expect(jobOf("job-old").state).toBe("failed");
    expect(fakes.submitAnswer).not.toHaveBeenCalled();
  });

  it("leaves a run that failed at its own work for the person to retry", async () => {
    fakes.stored.tutor_job = [saved({ error: "The reply had nothing Misty could use." })];
    await follow();
    expect(jobOf("job-old").state).toBe("failed");
    expect(fakes.submitAnswer).not.toHaveBeenCalled();
  });

  it("fails a run whose reply waits on a turn that no longer runs, then starts it again", async () => {
    const orphan: Chat = {
      id: "chat-orphan",
      title: "Flashcards: Volcanoes",
      messages: [
        {
          id: "a",
          role: "assistant",
          mode: "ask",
          content: "",
          createdAt: "",
          state: "streaming",
          invocationId: "inv-gone",
        },
      ],
    };
    setChats({ conversations: [elsewhere, orphan] });
    fakes.stored.tutor_job = [saved({ state: "running", conversationId: orphan.id })];
    await follow();

    await vi.waitFor(() => expect(fakes.readRunState).toHaveBeenCalledWith("inv-gone"));
    await vi.waitFor(() => expect(jobOf("job-old").state).toBe("running"));
    expect(jobOf("job-old").restarts).toBe(1);
    expect(fakes.submitAnswer).toHaveBeenCalledTimes(1);
  });

  it("keeps waiting on a run native code still has", async () => {
    fakes.readRunState.mockResolvedValue("running");
    const live: Chat = {
      id: "chat-live",
      title: "Flashcards: Volcanoes",
      messages: [
        {
          id: "a",
          role: "assistant",
          mode: "ask",
          content: "",
          createdAt: "",
          state: "streaming",
          invocationId: "inv-live",
        },
      ],
    };
    setChats({ conversations: [elsewhere, live] });
    fakes.stored.tutor_job = [saved({ state: "running", conversationId: live.id })];
    await follow();

    await vi.waitFor(() => expect(fakes.readRunState).toHaveBeenCalledWith("inv-live"));
    await flush();
    expect(jobOf("job-old").state).toBe("running");
    expect(fakes.submitAnswer).not.toHaveBeenCalled();
  });

  it("makes audio again that was being spoken when Misty closed", async () => {
    fakes.stored.tutor_guide = [
      { id: "overview-1", kind: "overview", audio: { state: "making" } },
      { id: "video-1", kind: "video", audio: { state: "making" } },
      { id: "overview-2", kind: "overview", audio: { state: "ready" } },
    ];
    await follow();
    expect(fakes.makeOverviewAudio).toHaveBeenCalledWith("overview-1");
    expect(fakes.makeVideoAudio).toHaveBeenCalledWith("video-1");
    expect(fakes.makeOverviewAudio).not.toHaveBeenCalledWith("overview-2");
  });
});
