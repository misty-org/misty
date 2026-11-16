import { describe, expect, it, vi } from "vitest";
import type { TutorJob } from "./tutorTypes";
import { fakes, finish, flush, follow, jobOf, tutor } from "./tutorRuns.testFixtures";

// What the Lab does with its jobs when Misty opens again after closing under them.
describe("jobs Misty closed under", () => {
  const saved = (change: Partial<TutorJob>): TutorJob => ({
    id: "job-old",
    kind: "deck",
    title: "Flashcards: Volcanoes",
    agentId: "personal_engine_claude",
    prompt: "Make it",
    notebookId: "n1",
    state: "running",
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    ...change,
  });

  it("follows a run native code still has to its end", async () => {
    fakes.readRunState.mockResolvedValue("running");
    fakes.stored.tutor_job = [saved({ runId: "run-live" })];
    await follow();

    await vi.waitFor(() => expect(fakes.followEngineRun).toHaveBeenCalledWith("run-live"));
    expect(fakes.runOnEngine).not.toHaveBeenCalled();
    await finish("run-live", '{"cards": [{"front": "a", "back": "b"}]}');
    expect(jobOf("job-old").state).toBe("done");
    expect(tutor().decks[jobOf("job-old").resultId!].cards).toHaveLength(1);
  });

  it("starts a run native code no longer has again, once", async () => {
    fakes.readRunState.mockResolvedValue("missing");
    fakes.stored.tutor_job = [saved({ runId: "run-gone" })];
    await follow();

    await vi.waitFor(() => expect(fakes.runOnEngine).toHaveBeenCalledTimes(1));
    expect(jobOf("job-old")).toMatchObject({ state: "running", restarts: 1 });
  });

  it("fails a run that was already started again once", async () => {
    fakes.stored.tutor_job = [saved({ runId: "run-gone", restarts: 1 })];
    await follow();

    await vi.waitFor(() =>
      expect(jobOf("job-old")).toMatchObject({
        state: "failed",
        error: "This run stopped before it finished.",
      }),
    );
    expect(fakes.runOnEngine).not.toHaveBeenCalled();
  });

  it("starts a job from before the default engine that was still waiting for its turn", async () => {
    // Its own id: an earlier test's run for "job-old" is still going in this module.
    fakes.stored.tutor_job = [
      saved({ id: "job-queued", state: "queued", conversationId: "chat-old" }),
    ];
    await follow();

    await vi.waitFor(() => expect(fakes.runOnEngine).toHaveBeenCalledTimes(1));
    expect(jobOf("job-queued")).toMatchObject({ state: "running", restarts: 0 });
  });

  it("leaves a job that failed at its own work for the person to retry", async () => {
    fakes.stored.tutor_job = [
      saved({ state: "failed", error: "The reply had nothing Misty could use." }),
    ];
    await follow();
    await flush();
    expect(jobOf("job-old").state).toBe("failed");
    expect(fakes.runOnEngine).not.toHaveBeenCalled();
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
